// Picks the api implementation at build time. The desktop (Tauri) build
// uses `tauriApi`, the iPad WKWebView build uses `webApi`.
//
// The choice is controlled by `__OONO_PLATFORM__`, a string constant
// injected by Vite via `define` (see vite.config.ts /
// vite.config.ios.ts). Default is "tauri".
//
// Both implementations expose the same shape (see ./api/web.ts and
// ./api/tauri.ts), so call-sites don't need to know which one they got.

import { tauriApi } from "./api/tauri";
import { webApi } from "./api/web";

declare const __OONO_PLATFORM__: "tauri" | "web";

export const api = __OONO_PLATFORM__ === "web" ? webApi : tauriApi;
