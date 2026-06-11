// Moves the live Chess.com board into a Document Picture-in-Picture window
// and back again. The board element itself is relocated (not cloned or
// captured), so the game remains fully interactive while in PiP.

const BOARD_SELECTORS = [
  "wc-chess-board",
  "chess-board",
  "#board-single",
  "#board-play-computer",
];

let pipWindow = null;
let placeholder = null;
let board = null;

// Chess.com's board component binds its drag-tracking listeners
// (pointermove/pointerup) to the page's document at init. Once the board
// moves to the PiP document those listeners never see PiP events, so drags
// track the mouse in the original window instead. Re-dispatching clones of
// the PiP window's events onto the main document fixes that; coordinates
// stay in PiP client space, which matches the board's bounding rect there.
// pointerdown is NOT forwarded — the element-level handler moved with the
// board and already fires, so forwarding it would double the pickup.
const FORWARDED_EVENTS = [
  "pointermove",
  "pointerup",
  "pointercancel",
  "mousemove",
  "mouseup",
];

function startEventForwarding() {
  const forward = (event) => {
    const Ctor = typeof event.pointerId === "number" ? PointerEvent : MouseEvent;
    document.dispatchEvent(
      new Ctor(event.type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        detail: event.detail,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        button: event.button,
        buttons: event.buttons,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        pressure: event.pressure,
      })
    );
  };
  for (const type of FORWARDED_EVENTS) {
    pipWindow.addEventListener(type, forward, true);
  }
}

function findBoard() {
  for (const selector of BOARD_SELECTORS) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function copyStyles(targetDoc) {
  for (const sheet of document.styleSheets) {
    try {
      const css = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
      const style = targetDoc.createElement("style");
      style.textContent = css;
      targetDoc.head.appendChild(style);
    } catch {
      // Cross-origin stylesheet — link it instead.
      if (sheet.href) {
        const link = targetDoc.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        targetDoc.head.appendChild(link);
      }
    }
  }
}

async function openPip() {
  board = findBoard();
  if (!board) {
    showToast("No board found on this page.");
    return;
  }

  const rect = board.getBoundingClientRect();
  pipWindow = await documentPictureInPicture.requestWindow({
    width: Math.round(rect.width) || 480,
    height: Math.round(rect.height) || 480,
  });

  copyStyles(pipWindow.document);

  const pipBody = pipWindow.document.body;
  pipBody.style.cssText =
    "margin:0;display:grid;place-items:center;background:#312e2b;overflow:hidden;";

  placeholder = document.createElement("div");
  placeholder.className = "chesspip-placeholder";
  placeholder.style.width = `${rect.width}px`;
  placeholder.style.height = `${rect.height}px`;
  placeholder.textContent = "Board is in Picture-in-Picture";
  board.replaceWith(placeholder);

  // Square, scaled to the smaller PiP dimension; pieces are positioned in
  // percentages so the board scales cleanly with its element.
  board.style.width = "100vmin";
  board.style.height = "100vmin";
  pipBody.appendChild(board);

  startEventForwarding();
  // Tell page-hooks.js (MAIN world) to keep the throttled tab rendering.
  document.dispatchEvent(new CustomEvent("chesspip-activate"));
  pipWindow.addEventListener("pagehide", restoreBoard, { once: true });
}

function restoreBoard() {
  document.dispatchEvent(new CustomEvent("chesspip-deactivate"));
  if (board && placeholder) {
    board.style.width = "";
    board.style.height = "";
    placeholder.replaceWith(board);
  }
  placeholder = null;
  board = null;
  pipWindow = null;
}

async function togglePip() {
  if (pipWindow) {
    pipWindow.close(); // fires pagehide -> restoreBoard
    return;
  }
  try {
    await openPip();
  } catch (err) {
    if (err.name === "NotAllowedError") {
      showToast("Use the on-page PiP button — Chrome needs a click on the page.");
    } else {
      showToast(`PiP failed: ${err.message}`);
    }
  }
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "chesspip-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function addToggleButton() {
  const button = document.createElement("button");
  button.className = "chesspip-button";
  button.title = "Toggle Picture-in-Picture";
  button.setAttribute("aria-label", "Toggle Picture-in-Picture");
  button.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 10h6V4"/>
      <path d="m2 4 6 6"/>
      <path d="M21 10V7a2 2 0 0 0-2-2h-7"/>
      <path d="M3 14v2a2 2 0 0 0 2 2h3"/>
      <rect x="12" y="14" width="10" height="7" rx="1"/>
    </svg>`;
  button.addEventListener("click", togglePip);
  document.body.appendChild(button);
}

if (!("documentPictureInPicture" in window)) {
  console.warn("[ChessPiP] Document Picture-in-Picture is not supported in this browser.");
} else {
  addToggleButton();
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "toggle-pip") togglePip();
  });
}
