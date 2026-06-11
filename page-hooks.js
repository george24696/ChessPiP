// Runs in the page's MAIN world (content scripts are isolated and can't
// patch the page's globals). While the board is in PiP, the main tab is
// often hidden/minimized and Chrome throttles it: requestAnimationFrame
// stops firing and the page reports itself hidden, so chess.com's scripts
// stop rendering incoming moves even though the board is visible in PiP.
//
// While active (toggled by content.js via DOM events):
//  - requestAnimationFrame delegates to the PiP window's scheduler, which
//    keeps running because the PiP window stays visible
//  - document.visibilityState/hidden report "visible" and visibilitychange
//    is muted, so the page never pauses itself
(() => {
  let active = false;

  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCaf = window.cancelAnimationFrame.bind(window);
  const pip = () => window.documentPictureInPicture?.window ?? null;

  // Offset our handle counter so it can't collide with ids the native
  // scheduler handed out before the patch was in place.
  let nextHandle = 1_000_000_000;
  const handles = new Map();

  window.requestAnimationFrame = (callback) => {
    const handle = nextHandle++;
    const pw = active ? pip() : null;
    const schedule = pw ? pw.requestAnimationFrame.bind(pw) : nativeRaf;
    const realId = schedule((t) => {
      handles.delete(handle);
      // PiP timestamps come from the PiP window's time origin; hand the
      // callback this window's clock so animation math stays consistent.
      callback(pw ? performance.now() : t);
    });
    handles.set(handle, { win: pw, realId });
    return handle;
  };

  window.cancelAnimationFrame = (handle) => {
    const entry = handles.get(handle);
    if (!entry) return nativeCaf(handle);
    handles.delete(handle);
    if (entry.win) entry.win.cancelAnimationFrame(entry.realId);
    else nativeCaf(entry.realId);
  };

  const visibilityState = Object.getOwnPropertyDescriptor(
    Document.prototype,
    "visibilityState"
  );
  const hidden = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");

  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get() {
      return active ? "visible" : visibilityState.get.call(document);
    },
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get() {
      return active ? false : hidden.get.call(document);
    },
  });

  window.addEventListener(
    "visibilitychange",
    (event) => {
      if (active) event.stopImmediatePropagation();
    },
    true
  );

  document.addEventListener("chesspip-activate", () => {
    active = true;
  });
  document.addEventListener("chesspip-deactivate", () => {
    active = false;
  });
})();
