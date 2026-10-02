// Service worker: the right-click menu, the side panel, and the badge that shows what the credit is worth now.
import { badge, fetchKey, getSettings } from "./shared.js";

const MENU = {
  ask: { title: "Ask Orbz about this", contexts: ["selection"] },
  explain: { title: "Explain this", contexts: ["selection"] },
  summarize: { title: "Summarize this", contexts: ["selection"] },
  translate: { title: "Translate this to English", contexts: ["selection"] },
  reply: { title: "Draft a reply to this", contexts: ["selection"] },
  check: { title: "Check this token", contexts: ["selection"] },
  page: { title: "Summarize this page", contexts: ["page"] },
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const [id, m] of Object.entries(MENU)) chrome.contextMenus.create({ id, title: m.title, contexts: m.contexts });
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.alarms.create("balance", { periodInMinutes: 10 });
  refreshBadge();
});

chrome.runtime.onStartup.addListener(refreshBadge);
chrome.alarms.onAlarm.addListener((a) => a.name === "balance" && refreshBadge());
chrome.storage.onChanged.addListener((c, area) => area === "local" && (c.key || c.base) && refreshBadge());
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "balance" && typeof msg.value === "string") setBadge(msg.value);
});

/** The page's own text, trimmed to what a summary needs. Runs inside the tab, only when the user asks. */
function pageText() {
  const pick = (sel) => document.querySelector(sel);
  const root = pick("article") || pick("main") || pick('[role="main"]') || document.body;
  const text = (root && root.innerText ? root.innerText : "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title: document.title, url: location.href, text: text.slice(0, 14_000), truncated: text.length > 14_000 };
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  let task = { kind: info.menuItemId, selection: (info.selectionText || "").trim(), title: tab.title || "", url: tab.url || "" };
  if (info.menuItemId === "page") {
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageText });
      task = { ...task, ...r.result };
    } catch {
      task.error = "This page cannot be read (browser pages and some sites are off limits).";
    }
  }
  await chrome.storage.session.set({ task });
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

async function setBadge(value) {
  const text = badge(value);
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#FF7A1A" });
  await chrome.action.setBadgeTextColor({ color: "#141312" }).catch(() => {});
  await chrome.action.setTitle({ title: text ? `Orbz · ${text} of credit` : "Orbz" });
}

async function refreshBadge() {
  const s = await getSettings();
  if (!s.key) return chrome.action.setBadgeText({ text: "" });
  try {
    const k = await fetchKey(s);
    await setBadge(k.balance);
    await chrome.storage.session.set({ keyInfo: k, keyAt: Date.now() });
  } catch (e) {
    if (e && e.status === 401) await chrome.action.setBadgeText({ text: "!" });
  }
}
