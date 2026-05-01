# Oono Ent

A free, cross-source entertainment app for macOS. One window, one player, four content lanes — global IPTV, P2P live sports, TMDb-powered movies and series, and curated Zimbabwean radio.

Built with **Tauri 2** (Rust backend), **React + TypeScript** (frontend), **hls.js** for HLS streams, **mpegts.js** for the P2P sports path, and a small embedded HTTP proxy in Rust for CORS, header injection, and m3u8 segment-URL rewriting.

> macOS-first. Apple Silicon and Intel both supported.

---

## Features

### Live TV
- Channels merged from [iptv-org](https://github.com/iptv-org/iptv) and other open M3U lists.
- Search and filter by category, **country**, and quality (1080p / 720p / 480p / SD).
- Add your own M3U sources from Settings.

### Live sports
- Acestream P2P streams played **inside the app** via a bundled Linux VM (Apple Virtualization framework + Rosetta-for-Linux). No external Acestream installation required.
- A built-in **match-to-channel resolver** that maps live fixtures to the correct broadcaster channel — runs ~8 engine searches in parallel (per-league broadcasters first, league keywords next, generic sport catch-alls last) and merges results, so e.g. "Aston Villa @ Forest" in the Europa League surfaces TNT Sports candidates with peer/quality stats attached.
- Sports schedule pulled from ESPN's public API across ~50 leagues (EPL, La Liga, Bundesliga, Serie A, Ligue 1, all UEFA cups, MLS, Liga MX, Brasileirão, NBA, NFL, NHL, MLB, F1, UFC, etc.).
- Real-time status (`pre` / `in` / `post`), peer count, download speed, and stream-prep progress shown during cold starts.
- Engine session lifecycle is properly serialised — opening a new channel cleanly stops the old one before starting the next.

### Movies & Series (VOD)
- TMDb catalogue with detail pages, cast/crew, production companies, taglines, and a **Watch series** button on TV detail pages.
- Browse-all view with infinite scroll and comprehensive filters: genre, year range, original language, region, minimum rating, minimum vote count, runtime range, and 8 sort orders.
- **Right-click context menu** on every poster: Watch now, Add to watchlist, Mark as watched, Open details.
- **Original-language badges** on poster cards (`JP`, `KR`, `HI`, `ES`, etc.) for non-English content.
- Watchlist + continue-watching with auto-play next episode.
- Click any cast member to see their full filmography.

### Radio
- Curated Zimbabwean stations: ZBC (Radio Zimbabwe, Power FM, National FM, Khulumani), Zimpapers (Star FM, Classic 263, Diamond FM), commercial (ZiFM Stereo, Capitalk, Skyz Metro), regional (Hevoi, Breeze, YA FM, 98.4 Midlands).
- Persistent radio mini-player that survives navigation.
- Falls back to [radio-browser.info](https://www.radio-browser.info/) for any station whose direct stream URL hasn't been resolved yet.

### Player
- Single persistent player across navigation; theater mode; native fullscreen via Tauri window API.
- **AirPlay** button for HLS sources.
- **Picture-in-picture**: native HTML video PiP for live TV, Tauri-window-based always-on-top PiP for VOD iframes.
- Quality menu for HLS (Auto/1080p/720p/480p) plus a read-only stream info panel for mpegts.js (Acestream is single-bitrate end-to-end).

### macOS integration
- **Stateful menubar tray icon**: shows the now-playing title in the menubar. Menu has Play/Pause, Stop, Next episode, plus Engine Start/Restart/Stop, plus Show/Hide/Quit.
- **Close-to-tray**: clicking the red ✕ hides the window, leaving the engine and radio running. Cmd+Q or tray Quit fully exits.
- App icon with proper macOS dock-icon padding.

---

## Install (prebuilt)

For now, build from source — see below. Prebuilt releases will land on the GitHub Releases page once notarisation / code-signing infra is set up.

---

## Build from source

### Prerequisites
- macOS 13.0 (Ventura) or later — required for Apple Virtualization framework features used by the bundled VM.
- [Rust](https://rustup.rs/) (stable).
- [Node.js](https://nodejs.org/) 18+ and [pnpm](https://pnpm.io/).
- [Tauri prerequisites](https://tauri.app/start/prerequisites/) (Xcode CLT).
- For the bundled VM: [Docker](https://docs.docker.com/desktop/install/mac-install/) (only needed at build time to bake the rootfs).

### Steps

```bash
git clone https://github.com/panda-zw/oono-ent.git
cd oono-ent

# Install JS deps
pnpm install

# Build the bundled Linux VM (Acestream Engine 3.2.11 + busybox + vsock-bridge).
# Produces src-tauri/resources/vm/{kernel,initrd,rootfs.img,manifest.json}.
# Takes ~5 minutes; requires Docker. Skip if you don't need live sports.
./scripts/build-acestream-vm.sh

# Compile the macOS sidecar that hosts the VM via Apple Virtualization framework.
./scripts/build-vm-host.sh

# Dev (hot reload)
pnpm tauri dev

# Production .app
pnpm tauri build --bundles app
# .app lands at src-tauri/target/release/bundle/macos/Oono Ent.app
```

### TMDb API key

Movies and Series need a TMDb v3 API key. Grab one for free at <https://www.themoviedb.org/settings/api>, then paste it into Settings → TMDb API key on first launch. The key is stored locally in the app's SQLite DB and never leaves your machine.

---

## Architecture (one-page tour)

```
┌────────────────────────────────────────────────────────────┐
│  React + TS frontend (Vite)                                │
│   Live TV / Movies / Series / Radio / Acestream pages       │
│   Player (hls.js + mpegts.js + Tauri APIs)                  │
└──────────────────────┬─────────────────────────────────────┘
                       │  IPC (tauri::command)
┌──────────────────────▼─────────────────────────────────────┐
│  Rust backend                                              │
│   data.rs          : Tauri commands surface                │
│   acestream.rs     : engine session lifecycle, search      │
│   sports.rs        : ESPN scoreboard ingestion             │
│   vod.rs           : TMDb client + watchlist + progress    │
│   radio.rs         : ZW curated overlay + radio-browser    │
│   sources.rs / m3u : iptv-org + custom M3U lists           │
│   proxy.rs         : embedded HTTP proxy (CORS, headers,   │
│                      m3u8 segment-URL rewriting)           │
│   vm_host.rs       : sidecar IPC for the bundled Linux VM  │
└──────────────────────┬─────────────────────────────────────┘
                       │  VSOCK
┌──────────────────────▼─────────────────────────────────────┐
│  oono-vm-host (Swift, sidecar process)                     │
│   Apple Virtualization framework: VZVirtualMachine         │
│   VZVirtioSocketDeviceConfiguration + Rosetta share        │
└──────────────────────┬─────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────┐
│  Bundled Linux VM (ARM64 init → x86_64 userspace via       │
│  Rosetta-for-Linux)                                        │
│   • busybox PID 1                                          │
│   • Acestream Engine 3.2.11 (vstavrinov image)             │
│   • vsock-bridge (forwards :6878 to the host over VSOCK)   │
└────────────────────────────────────────────────────────────┘
```

Key non-obvious bits:

- **Why not direct hls.js for Acestream?** The engine's `/ace/manifest.m3u8` returns a non-standard single-segment infinite playlist. hls.js stalls forever waiting for `FRAG_LOADED`. We use `/ace/getstream` (raw chunked MPEG-TS) + mpegts.js instead, with `transcode_ac3=1` + `transcode_audio=1` to keep audio in MSE-decodable AAC.
- **Why a proxy?** Webview origin (`http://localhost:1420` in dev) is treated as cross-origin to `127.0.0.1:6878`. The proxy fronts every external stream, adds `Access-Control-Allow-Origin`, injects per-channel `Referer`/`User-Agent` headers (Zeno.fm, certain IPTV streams), and rewrites `.m3u8` segment URLs to stay on the proxy.
- **Why the bundled VM?** Acestream Engine has no native macOS build. Running it inside Apple's Virtualization framework with Rosetta-for-Linux gives ~5-second cold start and zero install steps for the user.

---

## Acknowledgements

- [Tauri](https://tauri.app/) for the desktop runtime.
- [iptv-org](https://github.com/iptv-org) for the live-TV channel database.
- [TheMovieDB](https://www.themoviedb.org/) for movie/series metadata (subject to their non-commercial API terms).
- [ESPN](https://www.espn.com/) public scoreboard API for sports schedules.
- [radio-browser.info](https://www.radio-browser.info/) for crowdsourced radio metadata.
- [hls.js](https://github.com/video-dev/hls.js) and [mpegts.js](https://github.com/xqq/mpegts.js) for in-browser stream demuxing.
- The [Acestream Engine](https://acestream.media/) authors and the [vstavrinov/acestream-service](https://hub.docker.com/r/vstavrinov/acestream-service) image maintainers.

---

## License

[MIT](LICENSE) © Panashe Mapika
