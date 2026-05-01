import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Sidebar } from "@/components/sidebar";
import { Spotlight } from "@/components/ui/spotlight";
import { Player } from "@/components/player";
import { ResizeHandle } from "@/components/resize-handle";
import { VodPersistent } from "@/components/vod-persistent";
import { useAppStore } from "@/store";
import { HomePage } from "@/pages/home";
import { BrowsePage } from "@/pages/browse";
import { FavoritesPage } from "@/pages/favorites";
import { SettingsPage } from "@/pages/settings";
import { MoviesPage } from "@/pages/movies";
import { SeriesPage } from "@/pages/series";
import { VodDetailPage } from "@/pages/vod-detail";
import { WatchPage } from "@/pages/watch";
import { WatchlistPage } from "@/pages/watchlist";
import { AcestreamPage } from "@/pages/acestream";
import { RadioPage } from "@/pages/radio";
import { PersonPage } from "@/pages/person";
import { BrowseVodPage } from "@/pages/browse-vod";
import { RadioPlayer } from "@/components/radio-player";
import { TraySync } from "@/components/tray-sync";

export default function App() {
  const current = useAppStore((s) => s.current);
  const setCurrent = useAppStore((s) => s.setCurrent);
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth);
  const playerWidth = useAppStore((s) => s.playerWidth);
  const setPlayerWidth = useAppStore((s) => s.setPlayerWidth);
  const location = useLocation();
  const isWatch = location.pathname.startsWith("/watch/");

  useEffect(() => {
    if (viewMode !== "theater") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewMode("split");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewMode, setViewMode]);

  // Theater mode keeps the routes tree mounted so page state (search
  // queries, filters, scroll position) survives toggling. We also keep a
  // single Player instance mounted across the transition — only its
  // wrapper's positioning changes — so the engine session, mpegts.js
  // demuxer, MSE buffer, and play state all carry over without a re-prep.
  const inTheater = viewMode === "theater" && !!current && !isWatch;

  return (
    <div className="relative flex h-screen w-screen overflow-hidden">
      <Spotlight />
      <div className={inTheater ? "hidden" : "contents"}>
        <Sidebar width={sidebarWidth} />
        <ResizeHandle
          side="right"
          min={200}
          max={360}
          value={sidebarWidth}
          onChange={setSidebarWidth}
        />
      </div>
      <main className="relative z-10 flex min-w-0 flex-1 gap-2 p-3">
        <div
          className={
            inTheater ? "hidden" : "flex min-w-0 flex-1 flex-col"
          }
        >
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/browse" element={<BrowsePage />} />
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/movies" element={<MoviesPage />} />
            <Route path="/series" element={<SeriesPage />} />
            <Route path="/movies/:id" element={<VodDetailPage kind="movie" />} />
            <Route path="/series/:id" element={<VodDetailPage kind="tv" />} />
            <Route path="/watch/:kind/:id" element={<WatchPage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/acestream" element={<AcestreamPage />} />
            <Route path="/radio" element={<RadioPage />} />
            <Route path="/people/:id" element={<PersonPage />} />
            <Route path="/browse/:kind" element={<BrowseVodPage />} />
          </Routes>
        </div>
        {current && !isWatch && (
          <>
            {!inTheater && (
              <ResizeHandle
                side="left"
                min={420}
                max={1100}
                value={playerWidth}
                onChange={setPlayerWidth}
              />
            )}
            <aside
              className={
                inTheater
                  ? "absolute inset-0 z-40 flex bg-black"
                  : "hidden shrink-0 lg:flex"
              }
              style={inTheater ? undefined : { width: playerWidth }}
            >
              <div className="h-full w-full">
                <Player
                  channel={current}
                  onClose={() => setCurrent(null)}
                  onToggleTheater={() =>
                    setViewMode(inTheater ? "split" : "theater")
                  }
                  theater={inTheater}
                />
              </div>
            </aside>
          </>
        )}
      </main>
      <VodPersistent />
      <RadioPlayer />
      <TraySync />
    </div>
  );
}

