import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Maximize2,
  Minimize2,
  Minus,
  PictureInPicture2,
  SkipForward,
  X,
} from "lucide-react";
import { api } from "@/api";
import { useAppStore } from "@/store";
import type { EmbedProvider } from "@/types";
import { cn } from "@/lib/utils";
import {
  exitFullscreen,
  isFullscreen as docIsFullscreen,
  onFullscreenChange,
  requestFullscreen,
} from "@/lib/fullscreen";
import {
  closeVodPip,
  openDocumentPip,
  openVodPip,
  supportsDocumentPip,
  supportsVodPip,
} from "@/lib/pip";

const PROVIDERS: { id: EmbedProvider; label: string }[] = [
  { id: "vidsrc", label: "VidSrc" },
  { id: "2embed", label: "2Embed" },
  { id: "autoembed", label: "AutoEmbed" },
  { id: "vidlink", label: "VidLink" },
];

export function VodPersistent() {
  const vodPlaying = useAppStore((s) => s.vodPlaying);
  const setVodPlaying = useAppStore((s) => s.setVodPlaying);
  const minimized = useAppStore((s) => s.vodMinimized);
  const setMinimized = useAppStore((s) => s.setVodMinimized);
  const autoplay = useAppStore((s) => s.vodAutoplay);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  const stageRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [pipActive, setPipActive] = useState(false);

  const isWatch = location.pathname.startsWith("/watch/");
  const expanded = isWatch && !minimized;

  const embedUrl = useQuery({
    queryKey: [
      "vod",
      "embed",
      vodPlaying?.provider,
      vodPlaying?.kind,
      vodPlaying?.tmdbId,
      vodPlaying?.season,
      vodPlaying?.episode,
    ],
    queryFn: () =>
      api.vodEmbedUrl(
        vodPlaying!.provider,
        vodPlaying!.kind,
        vodPlaying!.tmdbId,
        vodPlaying!.season,
        vodPlaying!.episode,
      ),
    enabled: !!vodPlaying,
  });

  const episodes = useQuery({
    queryKey: ["vod", "episodes", vodPlaying?.tmdbId, vodPlaying?.season],
    queryFn: () => api.vodEpisodes(vodPlaying!.tmdbId, vodPlaying!.season!),
    enabled:
      !!vodPlaying &&
      vodPlaying.kind === "tv" &&
      vodPlaying.season !== null,
  });

  const nextEpisode = useMemo(() => {
    if (!vodPlaying || vodPlaying.kind !== "tv" || !episodes.data) return null;
    return (
      episodes.data.find((e) => e.episode_number === (vodPlaying.episode ?? 0) + 1) ??
      null
    );
  }, [episodes.data, vodPlaying]);

  const markCompleted = useMutation({
    mutationFn: () => api.vodMarkCompleted(vodPlaying!.mediaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vod", "continueWatching"] });
    },
  });

  const saveProgress = useMutation({
    mutationFn: () =>
      api.vodSaveProgress(
        vodPlaying!.mediaId,
        vodPlaying!.season,
        vodPlaying!.episode,
        vodPlaying!.provider,
        false,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vod", "continueWatching"] });
    },
  });

  useEffect(() => {
    if (vodPlaying) saveProgress.mutate();
  }, [
    vodPlaying?.mediaId,
    vodPlaying?.season,
    vodPlaying?.episode,
    vodPlaying?.provider,
  ]);

  useEffect(() => {
    return onFullscreenChange(() => setFullscreen(docIsFullscreen()));
  }, []);

  const [showUpNext, setShowUpNext] = useState(false);
  const [autoCountdown, setAutoCountdown] = useState(15);

  useEffect(() => {
    setShowUpNext(false);
    setAutoCountdown(15);
    if (
      !autoplay ||
      !vodPlaying ||
      vodPlaying.kind !== "tv" ||
      !nextEpisode ||
      !vodPlaying.runtimeMin
    )
      return;
    const totalMs = vodPlaying.runtimeMin * 60_000;
    const showAt = Math.max(15_000, totalMs - 60_000);
    const t = setTimeout(() => setShowUpNext(true), showAt);
    return () => clearTimeout(t);
  }, [
    vodPlaying?.mediaId,
    vodPlaying?.season,
    vodPlaying?.episode,
    autoplay,
    nextEpisode?.episode_number,
    vodPlaying?.runtimeMin,
  ]);

  useEffect(() => {
    if (!showUpNext) return;
    setAutoCountdown(15);
    const interval = setInterval(() => {
      setAutoCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          playNext();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [showUpNext]);

  const playNext = () => {
    if (!vodPlaying || !nextEpisode) return;
    setShowUpNext(false);
    setVodPlaying({
      ...vodPlaying,
      episode: nextEpisode.episode_number,
      runtimeMin: nextEpisode.runtime ?? vodPlaying.runtimeMin,
    });
    if (isWatch) {
      navigate(
        `/watch/tv/${vodPlaying.tmdbId}?s=${vodPlaying.season}&e=${nextEpisode.episode_number}`,
        { replace: true },
      );
    }
  };

  const setProvider = (p: EmbedProvider) => {
    if (!vodPlaying) return;
    setVodPlaying({ ...vodPlaying, provider: p });
  };

  const toggleFullscreen = async () => {
    const el = stageRef.current;
    if (!el) return;
    if (docIsFullscreen()) await exitFullscreen();
    else await requestFullscreen(el);
  };

  const togglePip = async () => {
    if (pipActive) {
      // Already in PiP — close the floating window or restore from doc PiP.
      await closeVodPip();
      setPipActive(false);
      return;
    }
    // Prefer Chromium Document PiP (rarely available in our WKWebView build);
    // fall back to a Tauri floating always-on-top window which works in
    // every environment we ship to and gives a real PiP experience for the
    // iframe-based VOD player.
    if (supportsDocumentPip()) {
      const ifr = iframeRef.current;
      if (ifr) {
        const win = await openDocumentPip(ifr, () => setPipActive(false));
        if (win) {
          setPipActive(true);
          return;
        }
      }
    }
    if (supportsVodPip() && embedUrl.data) {
      const win = await openVodPip({
        embedUrl: embedUrl.data,
        title: vodPlaying ? `${vodPlaying.title} — PiP` : "Oono Ent PiP",
        onClose: () => setPipActive(false),
      });
      if (win) setPipActive(true);
    }
  };

  const expand = () => {
    if (!vodPlaying) return;
    setMinimized(false);
    const path =
      vodPlaying.kind === "tv" &&
      vodPlaying.season !== null &&
      vodPlaying.episode !== null
        ? `/watch/tv/${vodPlaying.tmdbId}?s=${vodPlaying.season}&e=${vodPlaying.episode}`
        : `/watch/${vodPlaying.kind}/${vodPlaying.tmdbId}`;
    navigate(path);
  };

  if (!vodPlaying) return null;

  const subtitle =
    vodPlaying.kind === "tv" &&
    vodPlaying.season !== null &&
    vodPlaying.episode !== null
      ? `S${vodPlaying.season} · E${vodPlaying.episode}`
      : null;

  return (
    <div
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden bg-black",
        expanded
          ? "inset-0"
          : "bottom-safe-4 right-safe-4 w-105 rounded-xl border border-white/10 shadow-2xl",
      )}
    >
      {expanded ? (
        <header className="pt-safe-3 pl-safe-3 pr-safe-3 flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-black/40 pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1.5 text-xs hover:bg-white/15"
            >
              <ChevronLeft className="size-3.5" />
              Back
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">
                {vodPlaying.title}
              </div>
              {subtitle && <div className="text-xs text-white/50">{subtitle}</div>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setProvider(p.id)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs transition-colors",
                    vodPlaying.provider === p.id
                      ? "bg-cyan-300/20 text-cyan-100"
                      : "bg-white/5 text-white/60 hover:bg-white/10",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {nextEpisode && (
              <button
                onClick={playNext}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/15"
                title={`Next: ${nextEpisode.name}`}
              >
                <SkipForward className="size-3.5" />
                Next ep
              </button>
            )}
            {(supportsDocumentPip() || supportsVodPip()) && (
              <button
                onClick={togglePip}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs hover:bg-white/15",
                  pipActive
                    ? "bg-cyan-300/20 text-cyan-100"
                    : "bg-white/5 text-white/80",
                )}
                title={pipActive ? "Close picture-in-picture" : "Picture in picture"}
              >
                <PictureInPicture2 className="size-3.5" />
                {pipActive ? "Exit PiP" : "PiP"}
              </button>
            )}
            <button
              onClick={() => setMinimized(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/15"
              title="Minimize"
            >
              <Minus className="size-3.5" />
              Mini
            </button>
            <button
              onClick={toggleFullscreen}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/15"
              title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? (
                <Minimize2 className="size-3.5" />
              ) : (
                <Maximize2 className="size-3.5" />
              )}
            </button>
            <button
              onClick={() => markCompleted.mutate()}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-300/15 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-300/25"
            >
              <Check className="size-3.5" />
              {markCompleted.isPending ? "Saving…" : "Mark watched"}
            </button>
          </div>
        </header>
      ) : (
        <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/60 px-2 py-1.5">
          <button
            onClick={expand}
            className="min-w-0 flex-1 text-left"
            title="Expand"
          >
            <div className="truncate text-xs font-medium text-white">
              {vodPlaying.title}
            </div>
            {subtitle && (
              <div className="text-[10px] text-white/50">{subtitle}</div>
            )}
          </button>
          {(supportsDocumentPip() || supportsVodPip()) && (
            <button
              onClick={togglePip}
              className={cn(
                "rounded-full p-1.5 hover:bg-white/10",
                pipActive ? "text-cyan-200" : "text-white/70",
              )}
              title={pipActive ? "Close picture-in-picture" : "Picture in picture"}
            >
              <PictureInPicture2 className="size-3.5" />
            </button>
          )}
          <button
            onClick={expand}
            className="rounded-full p-1.5 text-white/70 hover:bg-white/10"
            title="Expand"
          >
            <Maximize2 className="size-3.5" />
          </button>
          <button
            onClick={() => setVodPlaying(null)}
            className="rounded-full p-1.5 text-white/70 hover:bg-white/10"
            title="Close"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div ref={stageRef} className={cn("relative bg-black", expanded ? "flex-1" : "aspect-video")}>
        {pipActive ? (
          <div className="flex h-full w-full items-center justify-center text-xs text-white/50">
            Playing in picture-in-picture
          </div>
        ) : embedUrl.data ? (
          <iframe
            ref={iframeRef}
            key={embedUrl.data}
            src={embedUrl.data}
            // Embed providers (2Embed in particular) probe the iframe's
            // restriction context and refuse playback if they detect a
            // limited/sandboxed environment. We deliberately:
            //  - omit `sandbox` so all default permissions stay granted,
            //  - drop the `referrerPolicy="origin"` we used to set (it made
            //    the provider see only `tauri://localhost` as referrer,
            //    which their fraud-detection treats as suspicious),
            //  - widen `allow` to cover the features modern players expect.
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write; web-share; accelerometer; gyroscope"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-white/50">
            Loading player…
          </div>
        )}

        {showUpNext && nextEpisode && (
          <div className="absolute bottom-4 right-4 flex items-center gap-3 rounded-xl border border-white/10 bg-black/85 p-3 backdrop-blur-md">
            <div>
              <div className="text-[10px] uppercase text-white/50">
                Up next in {autoCountdown}s
              </div>
              <div className="text-sm font-medium text-white">
                Ep {nextEpisode.episode_number} · {nextEpisode.name}
              </div>
            </div>
            <button
              onClick={() => setShowUpNext(false)}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/80 hover:bg-white/20"
            >
              Cancel
            </button>
            <button
              onClick={playNext}
              className="rounded-lg bg-cyan-300/20 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-300/30"
            >
              Play now
            </button>
          </div>
        )}
      </div>

      {expanded && !fullscreen && (
        <div className="border-t border-amber-300/20 bg-amber-300/5 px-4 py-2 text-xs text-amber-200/80">
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle className="size-3.5" />
            Powered by third-party embed providers. If one doesn't load, switch
            to another above.
          </span>
        </div>
      )}
    </div>
  );
}
