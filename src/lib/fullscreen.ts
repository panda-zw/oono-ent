// Fullscreen helpers. WKWebView (the engine Tauri uses on macOS) heavily
// restricts the JS Fullscreen API for non-video elements — calling
// `element.requestFullscreen()` on a div silently fails. We bypass that by
// driving the Tauri window's fullscreen state directly, which makes the
// whole app go fullscreen reliably across platforms. The element-level
// API is kept as a fallback for cases where we *can* fullscreen a single
// element (a `<video>`, typically).

import { getCurrentWindow } from "@tauri-apps/api/window";

type AnyEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};
type AnyDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  msFullscreenElement?: Element | null;
  msExitFullscreen?: () => Promise<void> | void;
};

let cachedFullscreen = false;

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isFullscreen() {
  const d = document as AnyDoc;
  if (d.fullscreenElement || d.webkitFullscreenElement || d.msFullscreenElement) {
    return true;
  }
  return cachedFullscreen;
}

export async function requestFullscreen(el: HTMLElement) {
  const e = el as AnyEl;
  // Try element-level first — works for native <video>.
  try {
    if (e.requestFullscreen) {
      await e.requestFullscreen();
      return;
    }
    if (e.webkitRequestFullscreen) {
      await e.webkitRequestFullscreen();
      return;
    }
    if (e.msRequestFullscreen) {
      await e.msRequestFullscreen();
      return;
    }
  } catch (err) {
    console.warn("element requestFullscreen failed, falling back to window", err);
  }
  // Fallback: window-level fullscreen via Tauri.
  if (inTauri()) {
    try {
      await getCurrentWindow().setFullscreen(true);
      cachedFullscreen = true;
    } catch (err) {
      console.warn("Tauri setFullscreen failed", err);
    }
  }
}

export async function exitFullscreen() {
  const d = document as AnyDoc;
  let exited = false;
  try {
    if (d.exitFullscreen) {
      await d.exitFullscreen();
      exited = true;
    } else if (d.webkitExitFullscreen) {
      await d.webkitExitFullscreen();
      exited = true;
    } else if (d.msExitFullscreen) {
      await d.msExitFullscreen();
      exited = true;
    }
  } catch (err) {
    console.warn("element exitFullscreen failed", err);
  }
  if (inTauri()) {
    try {
      await getCurrentWindow().setFullscreen(false);
      cachedFullscreen = false;
      exited = true;
    } catch (err) {
      console.warn("Tauri setFullscreen(false) failed", err);
    }
  }
  return exited;
}

export function onFullscreenChange(handler: () => void) {
  const onAny = () => {
    cachedFullscreen = false;
    handler();
  };
  document.addEventListener("fullscreenchange", onAny);
  document.addEventListener("webkitfullscreenchange", onAny);

  // Tauri window resize is the only signal we get when the window itself
  // toggles fullscreen state (no `fullscreenchange` event fires for it).
  let unlistenResize: (() => void) | null = null;
  if (inTauri()) {
    const w = getCurrentWindow();
    w.onResized(() => {
      w.isFullscreen()
        .then((fs) => {
          if (cachedFullscreen !== fs) {
            cachedFullscreen = fs;
            handler();
          }
        })
        .catch(() => {});
    }).then((fn) => {
      unlistenResize = fn;
    });
  }

  return () => {
    document.removeEventListener("fullscreenchange", onAny);
    document.removeEventListener("webkitfullscreenchange", onAny);
    if (unlistenResize) unlistenResize();
  };
}
