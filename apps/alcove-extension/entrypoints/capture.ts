/**
 * Unlisted script, injected with chrome.scripting.executeScript only after a user action
 * (toolbar button, context menu or keyboard shortcut). It exposes the capture API on the
 * isolated world's global object; the background script then calls it with a second
 * executeScript. There is no always-on content script.
 */

import { createCaptureApi } from "../lib/capture";

export default defineUnlistedScript(() => {
  globalThis.alcoveCapture ??= createCaptureApi();
});
