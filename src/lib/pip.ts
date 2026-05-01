// Picture-in-Picture support layer. We have three flavours:
//
// 1. Native HTMLVideoElement PiP (`requestPictureInPicture`) — works on
//    Safari/WKWebView for any normal `<video>` whose source is reachable.
//    Used by the live TV / Acestream player.
// 2. Document Picture-in-Picture (Chromium-only `documentPictureInPicture`)
//    — pops out a whole DOM subtree, useful for iframe content. WKWebView
//    does NOT support this, so it's effectively unavailable in our app.
// 3. Tauri floating window — for the VOD iframe (movies/series). We spawn
//    a small always-on-top WebviewWindow with the embed URL inside it,
//    giving the user a real picture-in-picture experience even though
//    WKWebView lacks the standardised APIs.

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";

type DocPiP = {
  requestWindow(opts?: { width?: number; height?: number }): Promise<Window>;
  window?: Window | null;
};

const VOD_PIP_LABEL = "vod-pip";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function supportsDocumentPip(): boolean {
  return typeof window !== "undefined" && "documentPictureInPicture" in window;
}

// VOD PiP is available whenever we're running inside Tauri — we don't need
// the browser's PiP APIs because we spawn a real Tauri window.
export function supportsVodPip(): boolean {
  return inTauri();
}

export function supportsVideoPip(): boolean {
  return (
    typeof document !== "undefined" &&
    "pictureInPictureEnabled" in document &&
    !!(document as Document & { pictureInPictureEnabled?: boolean })
      .pictureInPictureEnabled
  );
}

export async function openDocumentPip(
  iframe: HTMLIFrameElement,
  onClose?: () => void,
) {
  if (!supportsDocumentPip()) return null;
  const dpip = (
    window as Window & { documentPictureInPicture?: DocPiP }
  ).documentPictureInPicture!;
  const placeholder = iframe.parentElement;
  if (!placeholder) return null;
  const pipWin = await dpip.requestWindow({ width: 640, height: 360 });
  pipWin.document.body.style.margin = "0";
  pipWin.document.body.style.background = "#000";
  pipWin.document.body.style.overflow = "hidden";
  const adopted = pipWin.document.adoptNode(iframe);
  (adopted as HTMLIFrameElement).style.width = "100%";
  (adopted as HTMLIFrameElement).style.height = "100%";
  (adopted as HTMLIFrameElement).style.border = "0";
  pipWin.document.body.appendChild(adopted);
  pipWin.addEventListener("pagehide", () => {
    try {
      const back = document.adoptNode(adopted);
      placeholder.appendChild(back);
    } catch {}
    onClose?.();
  });
  return pipWin;
}

// Open or focus the VOD picture-in-picture floating Tauri window. The
// window loads the embed URL directly and stays on top of all other apps.
// If a PiP window already exists, we just bring it to front + reload the
// URL (which happens automatically when it's recreated with new state).
export async function openVodPip(opts: {
  embedUrl: string;
  title: string;
  onClose?: () => void;
}): Promise<WebviewWindow | null> {
  if (!inTauri()) return null;
  // If already open, close so we can recreate with the new URL.
  try {
    const existing = await WebviewWindow.getByLabel(VOD_PIP_LABEL);
    if (existing) {
      try {
        await existing.close();
      } catch {}
    }
  } catch {}

  const win = new WebviewWindow(VOD_PIP_LABEL, {
    url: opts.embedUrl,
    width: 480,
    height: 270,
    title: opts.title,
    decorations: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    minWidth: 320,
    minHeight: 180,
    focus: true,
  });

  win.once("tauri://created", async () => {
    // Position bottom-right by default. Failures here aren't fatal.
    try {
      const screen = await win.outerSize();
      void screen;
      await win.setPosition(new LogicalPosition(60, 60));
      await win.setSize(new LogicalSize(480, 270));
    } catch {}
  });
  win.once("tauri://destroyed", () => {
    opts.onClose?.();
  });
  win.once("tauri://close-requested", () => {
    opts.onClose?.();
  });

  return win;
}

export async function closeVodPip(): Promise<void> {
  if (!inTauri()) return;
  try {
    const existing = await WebviewWindow.getByLabel(VOD_PIP_LABEL);
    if (existing) await existing.close();
  } catch {}
}

export async function toggleVideoPip(video: HTMLVideoElement) {
  try {
    if (
      (document as Document & { pictureInPictureElement?: Element | null })
        .pictureInPictureElement
    ) {
      await document.exitPictureInPicture();
    } else {
      await video.requestPictureInPicture();
    }
  } catch (e) {
    console.warn("PiP failed", e);
  }
}
