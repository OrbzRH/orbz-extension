// The side panel: connect a key, chat with Orbz Opus, and act on what the right-click menu handed over.
import { ApiError, burnsIn, chat, fetchKey, getSettings, setSettings, usd } from "./shared.js";

const $ = (id) => document.getElementById(id);
const views = { connect: $("connect"), settings: $("settings"), chat: $("chat") };
const log = $("log");
let settings = { key: "", base: "" };
let keyInfo = null;
let history = []; // { role, content } sent to the model
let busy = null; // AbortController while a reply streams

const SYSTEM = "You are Orbz Opus inside a browser side panel. Be concise and useful. When the user hands you selected text or a page, work from it directly; do not ask for it again. Use plain text with light markdown (bold, bullets, code) only.";

// ── views ───────────────────────────────────────────────────────────────────────────────────────────
function show(name) {
  for (const [k, v] of Object.entries(views)) v.hidden = k !== name;
  $("meter").hidden = !settings.key;
  $("gear").hidden = name === "settings";
}

function renderMeter() {
  if (!keyInfo) return;
  $("balance").textContent = usd(keyInfo.balance);
  const first = keyInfo.buckets && keyInfo.buckets[0];
  const f = $("fuse");
  if (first && Number(first.remaining) > 0) {
    f.textContent = `${usd(first.remaining)} burns in ${burnsIn(first.burns_in_seconds)}`;
    f.className = "fuse" + (first.burns_in_seconds < 24 * 3600 ? " soon" : "");
  } else {
    f.textContent = "no credit yet";
    f.className = "fuse";
  }
  chrome.runtime.sendMessage({ type: "balance", value: keyInfo.balance }).catch(() => {});
}

async function refreshKey() {
  keyInfo = await fetchKey(settings);
  renderMeter();
  $("keyLabel").textContent = `${keyInfo.key.prefix}-…${keyInfo.key.last4} · number ${keyInfo.key.epoch}`;
  $("walletLabel").textContent = keyInfo.wallet;
  $("tierLabel").textContent = keyInfo.tier_name;
  $("limitsLabel").textContent = `${keyInfo.limits.requests_per_minute} requests/min · ${keyInfo.limits.concurrent} concurrent`;
}

// ── messages, rendered from DOM nodes only (never innerHTML) ───────────────────────────────────────
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function renderMarkdown(node, text) {
  while (node.firstChild) node.removeChild(node.firstChild);
  const blocks = String(text).split(/(```[\s\S]*?```)/);
  for (const block of blocks) {
    if (!block) continue;
    if (block.startsWith("```")) {
      const body = block.replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
      const pre = el("pre");
      pre.appendChild(el("code", null, body));
      node.appendChild(pre);
      continue;
    }
    const lines = block.split("\n");
    lines.forEach((raw, i) => {
      if (i) node.appendChild(document.createElement("br"));
      const line = raw.replace(/^(\s*)[*-]\s+/, "$1• ").replace(/^#{1,6}\s+/, "");
      for (const t of line.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
        if (!t) continue;
        if (t.length > 4 && t.startsWith("**") && t.endsWith("**")) node.appendChild(el("b", null, t.slice(2, -2)));
        else if (t.length > 2 && t.startsWith("`") && t.endsWith("`")) node.appendChild(el("code", null, t.slice(1, -1)));
        else node.appendChild(document.createTextNode(t));
      }
    });
  }
}

function addUser(label, quote) {
  const n = el("div", "m u");
  if (quote) {
    n.appendChild(el("span", "quote", quote.length > 400 ? quote.slice(0, 400) + "…" : quote));
  }
  n.appendChild(document.createTextNode(label));
  log.appendChild(n);
  scroll();
}

function addAssistant() {
  const n = el("div", "m a", "…");
  log.appendChild(n);
  scroll();
  return n;
}

function addReceipt(r) {
  if (r.cost == null) return;
  const n = el("div", "receipt");
  const toks = r.usage ? `${r.usage.total_tokens} tokens · ` : "";
  n.appendChild(document.createTextNode(`${toks}cost `));
  n.appendChild(el("b", null, usd(r.cost)));
  n.appendChild(document.createTextNode(` · balance ${usd(r.balance)}`));
  log.appendChild(n);
  scroll();
}

function addSys(text) {
  log.appendChild(el("div", "sys", text));
  scroll();
}

function scroll() {
  log.scrollTop = log.scrollHeight;
}

function empty() {
  if (log.children.length) return;
  const e = el("div", "empty");
  e.appendChild(el("b", null, "Select text on any page, right-click, Ask Orbz."));
  e.appendChild(document.createTextNode("Or ask here. Replies are paid from your credit at list price."));
  log.appendChild(e);
}

// ── sending ─────────────────────────────────────────────────────────────────────────────────────────
async function send(userText, { label = userText, quote = null } = {}) {
  if (busy) return;
  const e = log.querySelector(".empty");
  if (e) e.remove();
  addUser(label, quote);
  history.push({ role: "user", content: userText });
  const out = addAssistant();
  busy = new AbortController();
  $("send").hidden = true;
  $("stop").hidden = false;
  try {
    const r = await chat(settings, [{ role: "system", content: SYSTEM }, ...history.slice(-20)], {
      signal: busy.signal,
      onDelta: (_d, full) => {
        renderMarkdown(out, full);
        scroll();
      },
    });
    if (!r.text) {
      out.remove();
      history.pop();
      addSys("No answer came back.");
    } else {
      history.push({ role: "assistant", content: r.text });
      addReceipt(r);
      if (r.balance != null && keyInfo) {
        keyInfo.balance = r.balance;
        renderMeter();
      }
    }
  } catch (err) {
    if (err && err.name === "AbortError") {
      if (out.textContent === "…") {
        out.remove();
        history.pop();
      } else history.push({ role: "assistant", content: out.textContent });
      addSys("Stopped.");
    } else {
      out.remove();
      history.pop();
      addSys(err instanceof ApiError && err.code === "insufficient_credits" ? "Out of credit. Credit lands every 30 minutes while you hold 100,000 $ORBZ." : (err && err.message) || "Something went wrong.");
      if (err instanceof ApiError && err.status === 401) {
        addSys("This key no longer works. Open settings to connect another.");
      }
    }
  } finally {
    busy = null;
    $("send").hidden = false;
    $("stop").hidden = true;
    $("ask").focus();
  }
}

/** A task the right-click menu left for us: turn it into one message. */
async function takeTask() {
  const { task } = await chrome.storage.session.get("task");
  if (!task) return;
  await chrome.storage.session.remove("task");
  if (task.error) return addSys(task.error);
  const where = task.title ? `From "${task.title}"${task.url ? ` (${task.url})` : ""}:` : "";
  const sel = task.selection || "";
  const prompts = {
    ask: ["What is this about? Explain it, then say what matters most.", "Ask Orbz about this"],
    explain: ["Explain this in plain language. Define any terms a newcomer would not know.", "Explain this"],
    summarize: ["Summarize this in a few bullets. Keep every number and name that matters.", "Summarize this"],
    translate: ["Translate this to English. Keep names, numbers and formatting.", "Translate to English"],
    reply: ["Draft a short, polite reply to this message. Match its tone and language.", "Draft a reply"],
  };
  if (task.kind === "page") {
    if (!task.text) return addSys("This page has no readable text.");
    const note = task.truncated ? " (the page was long; this is the first part)" : "";
    await send(`${where}\n\n${task.text}\n\nSummarize this page in a few bullets${note}. Keep every number and name that matters.`, {
      label: `Summarize this page: ${task.title || task.url}`,
      quote: null,
    });
    return;
  }
  const p = prompts[task.kind];
  if (!p || !sel) return;
  await send(`${where}\n\n"""${sel}"""\n\n${p[0]}`, { label: p[1], quote: sel });
}

// ── wiring ──────────────────────────────────────────────────────────────────────────────────────────
$("connectForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = $("keyInput").value.trim();
  const base = ($("baseInput").value.trim() || "https://api.orbz.app/v1").replace(/\/+$/, "");
  if (!/^sk-orbz-\d+-[A-Za-z0-9_-]{10,}$/.test(key)) return showErr("That does not look like an Orbz key (sk-orbz-…).");
  $("connectBtn").disabled = true;
  try {
    await fetchKey({ key, base });
    await setSettings({ key, base });
    settings = { key, base };
    $("keyInput").value = "";
    await refreshKey();
    show("chat");
    empty();
    $("ask").focus();
  } catch (err) {
    showErr(err && err.status === 401 ? "This key was not accepted. Copy it again from the Keys page." : (err && err.message) || "Could not reach the API.");
  } finally {
    $("connectBtn").disabled = false;
  }
});
function showErr(t) {
  $("connectErr").textContent = t;
  $("connectErr").hidden = false;
}

$("askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("ask").value.trim();
  if (!q) return;
  $("ask").value = "";
  send(q);
});
$("ask").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("askForm").requestSubmit();
  }
});
$("stop").addEventListener("click", () => busy && busy.abort());
$("gear").addEventListener("click", () => show(settings.key ? "settings" : "connect"));
$("back").addEventListener("click", () => show(settings.key ? "chat" : "connect"));
$("refresh").addEventListener("click", () => refreshKey().catch((e) => addSys(e.message)));
$("clear").addEventListener("click", () => {
  history = [];
  log.replaceChildren();
  empty();
  show("chat");
});
$("disconnect").addEventListener("click", async () => {
  await setSettings({ key: "" });
  settings.key = "";
  keyInfo = null;
  history = [];
  log.replaceChildren();
  chrome.runtime.sendMessage({ type: "balance", value: "0" }).catch(() => {});
  show("connect");
});
chrome.storage.session.onChanged.addListener((c) => c.task && c.task.newValue && settings.key && takeTask());

(async () => {
  settings = await getSettings();
  $("baseInput").value = settings.base === "https://api.orbz.app/v1" ? "" : settings.base;
  if (!settings.key) return show("connect");
  show("chat");
  empty();
  try {
    await refreshKey();
  } catch (e) {
    if (e && e.status === 401) {
      addSys("This key no longer works. Connect another.");
      show("connect");
      return;
    }
    addSys("Could not reach the API. The balance will update when it answers.");
  }
  await takeTask();
})();
