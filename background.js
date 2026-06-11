chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !tab.url?.startsWith("https://www.chess.com/")) return;
  chrome.tabs.sendMessage(tab.id, { type: "toggle-pip" }).catch(() => {
    // Content script not loaded (e.g. tab opened before install) — ignore.
  });
});
