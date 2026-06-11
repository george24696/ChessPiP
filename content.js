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
let clockObservers = [];

// Extension-injected CSS (content.css) is a user stylesheet and never shows
// up in document.styleSheets, so copyStyles() can't carry it across — the
// PiP window gets its layout styles injected directly instead.
const PIP_STYLES = `
  html, body { height: 100%; }
  body { margin: 0; display: flex; flex-direction: column; background: #312e2b; overflow: hidden; }
  .chesspip-clock {
    display: none;
    justify-content: flex-end;
    align-items: center;
    padding: 5px 12px;
    background: #262522;
    color: #c3c2c1;
    font: 600 18px/1.2 -apple-system, "Segoe UI", Roboto, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .chesspip-clock.chesspip-has-clock { display: flex; }
  .chesspip-clock.chesspip-active { background: #5d9948; color: #fff; }
  .chesspip-stage { flex: 1 1 0; min-height: 0; display: grid; place-items: center; overflow: hidden; }
  .chesspip-board-box { transform-origin: center; }
`;

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
    // Extra room for the two clock bars.
    height: (Math.round(rect.height) || 480) + 64,
  });

  copyStyles(pipWindow.document);

  const doc = pipWindow.document;
  const style = doc.createElement("style");
  style.textContent = PIP_STYLES;
  doc.head.appendChild(style);

  const topClock = doc.createElement("div");
  topClock.className = "chesspip-clock";
  const bottomClock = doc.createElement("div");
  bottomClock.className = "chesspip-clock";
  const stage = doc.createElement("div");
  stage.className = "chesspip-stage";
  const boardBox = doc.createElement("div");
  boardBox.className = "chesspip-board-box";
  boardBox.style.width = `${rect.width}px`;
  boardBox.style.height = `${rect.height}px`;
  stage.appendChild(boardBox);
  doc.body.append(topClock, stage, bottomClock);

  placeholder = document.createElement("div");
  placeholder.className = "chesspip-placeholder";
  placeholder.style.width = `${rect.width}px`;
  placeholder.style.height = `${rect.height}px`;
  placeholder.textContent = "Board is in Picture-in-Picture";
  board.replaceWith(placeholder);

  // The board keeps its original pixel size (chess.com's JS manages it);
  // the wrapper is scaled as one unit so pieces, highlights and drag math
  // all stay consistent at any PiP size.
  board.style.width = "100%";
  board.style.height = "100%";
  boardBox.appendChild(board);

  const fitBoard = () => {
    const scale = Math.min(
      stage.clientWidth / rect.width,
      stage.clientHeight / rect.height
    );
    boardBox.style.transform = `scale(${scale})`;
  };
  fitBoard();
  pipWindow.addEventListener("resize", fitBoard);

  mirrorClocks(topClock, bottomClock);

  startEventForwarding();
  // Tell page-hooks.js (MAIN world) to keep the throttled tab rendering.
  document.dispatchEvent(new CustomEvent("chesspip-activate"));
  pipWindow.addEventListener("pagehide", restoreBoard, { once: true });
}

// Mirrors the page's clock elements into the PiP clock bars. The live
// clocks stay where they are (moving them would break chess.com's layout);
// a MutationObserver keeps each mirror's text and active state in sync.
function mirrorClocks(topMirror, bottomMirror) {
  const clocks = [...document.querySelectorAll(".clock-component")];
  if (!clocks.length) return;

  const top = clocks.find((c) => c.classList.contains("clock-top")) ?? clocks[0];
  const bottom =
    clocks.find((c) => c !== top && c.classList.contains("clock-bottom")) ??
    clocks.find((c) => c !== top);

  for (const [source, mirror] of [
    [top, topMirror],
    [bottom, bottomMirror],
  ]) {
    if (!source || !mirror) continue;
    mirror.classList.add("chesspip-has-clock");
    const sync = () => {
      mirror.textContent = source.textContent.replace(/\s+/g, " ").trim();
      mirror.classList.toggle(
        "chesspip-active",
        source.classList.contains("clock-player-turn")
      );
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(source, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    clockObservers.push(observer);
  }
}

function restoreBoard() {
  document.dispatchEvent(new CustomEvent("chesspip-deactivate"));
  clockObservers.forEach((observer) => observer.disconnect());
  clockObservers = [];
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
