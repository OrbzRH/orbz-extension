// Shared by the service worker and the side panel: settings, the API, and the money formatting.
// The key lives in chrome.storage.local, which web pages cannot read. Nothing here ever logs it.

export const DEFAULT_BASE = "https://api.orbz.app/v1";
export const MODEL = "orbz-opus";

export async function getSettings() {
  const s = await chrome.storage.local.get({ key: "", base: DEFAULT_BASE });
  return { key: s.key || "", base: (s.base || DEFAULT_BASE).replace(/\/+$/, "") };
}

export const setSettings = (patch) => chrome.storage.local.set(patch);

/** "0.388984" -> "$0.3890"; "12.5" -> "$12.50". */
export function usd(d) {
  const v = Number(d);
  if (!Number.isFinite(v)) return "$0.00";
  if (v >= 1) return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (v >= 0.0001) return `$${v.toFixed(4)}`;
  return v === 0 ? "$0.00" : "<$0.0001";
}

/** Badge text, at most four characters: "$12", "$1.2", "38¢", "0.1¢". */
export function badge(d) {
  const v = Number(d);
  if (!Number.isFinite(v) || v <= 0) return "";
  if (v >= 10) return `$${Math.floor(v)}`;
  if (v >= 1) return `$${v.toFixed(1)}`;
  const c = v * 100;
  return c >= 1 ? `${Math.floor(c)}¢` : `${c.toFixed(1)}¢`;
}

/** "6h", "2d 4h", "41m", "<1m". */
export function burnsIn(seconds) {
  if (seconds <= 0) return "burned";
  if (seconds < 60) return "<1m";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function fail(res) {
  let j = null;
  try {
    j = await res.json();
  } catch {}
  const e = (j && j.error) || {};
  throw new ApiError(res.status, e.code || "error", e.message || `Request failed (${res.status}).`);
}

/** GET /v1/key: balance, the fuse and the limits for this key. */
export async function fetchKey({ key, base }) {
  const res = await fetch(`${base}/key`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) await fail(res);
  return res.json();
}

/** A contract address inside any text, or null. */
export function findAddress(text) {
  const m = /0x[a-fA-F0-9]{40}/.exec(String(text || ""));
  return m ? m[0] : null;
}

/** POST /v1/token/facts: what the chain and the market say about a token. Free; no model involved. */
export async function tokenFacts({ key, base }, ca) {
  const res = await fetch(`${base}/token/facts`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ ca }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) await fail(res);
  return res.json();
}

/** Streams one chat completion. Resolves with { text, finish, cost, balance, usage }. */
export const chat = (s, messages, { signal, onDelta, maxTokens = 1024 } = {}) =>
  streamPost(s, "/chat/completions", { model: MODEL, stream: true, max_tokens: maxTokens, messages }, { signal, onDelta });

/** Streams Orbz Opus's read of a token (or its answer to a follow-up), paid like a chat completion. */
export const tokenRead = (s, ca, question = "", { signal, onDelta } = {}) => streamPost(s, "/token/read", { ca, question }, { signal, onDelta });

/**
 * One streamed POST. Calls onDelta(piece, fullText) as it arrives and resolves with
 * { text, finish, cost, balance, usage }. Aborting `signal` stops the stream; what was written is still billed.
 */
async function streamPost({ key, base }, path, body, { signal, onDelta } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) await fail(res);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let finish = "stop";
  let cost = null;
  let usage = null;
  let balance = res.headers.get("x-orbz-balance");
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let j;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.error) throw new ApiError(502, j.error.type || "error", j.error.message || "The answer stopped.");
      const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
      if (d) {
        text += d;
        if (onDelta) onDelta(d, text);
      }
      const f = j.choices && j.choices[0] && j.choices[0].finish_reason;
      if (f) finish = f;
      if (j.usage) usage = j.usage;
      if (j.orbz) {
        cost = j.orbz.cost;
        balance = j.orbz.balance_after;
      }
    }
  }
  return { text, finish, cost, balance, usage };
}
