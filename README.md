# ChessPiP

A Chrome extension that pops the Chess.com board out into an always-on-top Picture-in-Picture window, so you can keep playing (or watching) your game while working in other tabs or apps.

It uses the [Document Picture-in-Picture API](https://developer.chrome.com/docs/web-platform/document-picture-in-picture) to move the **live board element** into the PiP window — the game stays fully interactive, not a read-only video capture.

## Features

- Pop the live Chess.com board into a floating, always-on-top PiP window
- Board stays fully playable in PiP — moves, premoves, the lot
- Toggle via the floating on-page button or the extension toolbar icon
- Board returns to its place on the page when the PiP window closes

## Requirements

- Chrome 116 or newer (Document Picture-in-Picture API)

## Install (from source)

1. Clone the repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode**
4. Click **Load unpacked** and select the project folder

## Usage

1. Open a game on [chess.com](https://www.chess.com)
2. Click the round PiP button in the bottom-right corner of the page (or the ChessPiP toolbar icon)
3. The board pops out into its own always-on-top window — close it to send the board back

> Note: if the toolbar icon shows a "needs a click on the page" message, use the on-page button — Chrome requires a user gesture inside the page for Document PiP.

## How it works

- `content.js` finds the board element (`wc-chess-board`), opens a Document PiP window, copies the page's stylesheets across, and moves the board in, leaving a placeholder behind
- Pointer/mouse move and up events in the PiP window are re-dispatched onto the main document, because chess.com binds its drag-tracking listeners there at init — without this, drags would track the original window's mouse
- `page-hooks.js` (MAIN world, `document_start`) counters Chrome's background-tab throttling while PiP is open: `requestAnimationFrame` delegates to the PiP window's scheduler (which stays visible and unthrottled) and the page reports itself as visible — without this, minimizing the browser freezes board updates
- Closing the PiP window fires `pagehide`, which moves the board back into the placeholder's spot
- `background.js` forwards toolbar-icon clicks to the content script

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest, content script on `chess.com` |
| `content.js` | Board detection, PiP open/close, on-page toggle button |
| `content.css` | Styles for the toggle button, placeholder, and toasts |
| `page-hooks.js` | MAIN-world anti-throttling hooks (rAF delegation, visibility spoof) |
| `background.js` | Toolbar icon click handler |

## License

MIT
