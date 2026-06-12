import { useEffect, useRef, useState } from "react";
import Hls, { type ErrorData } from "hls.js";
import mpegts from "mpegts.js";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Cast,
  Gauge,
  Loader2,
  Maximize2,
  Minimize2,
  Monitor,
  Pause,
  PictureInPicture2,
  Play,
  Radio,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { api } from "@/api";
import type { AcestreamStat, ChannelRow } from "@/types";
import { cn } from "@/lib/utils";
import { useAppStore, type QualityPreference } from "@/store";
import {
  exitFullscreen,
  isFullscreen as docIsFullscreen,
  onFullscreenChange,
  requestFullscreen,
} from "@/lib/fullscreen";
import { supportsVideoPip, toggleVideoPip } from "@/lib/pip";

type Status = "idle" | "loading" | "playing" | "error";

const BANDWIDTH_KEY = "iptv:lastBandwidth";

function lastBandwidth(): number {
  const raw = localStorage.getItem(BANDWIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 800_000;
}

function fmtTime(s: number) {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

type LevelInfo = { index: number; height: number; bitrate: number };

function configFor(pref: QualityPreference, defaultEstimate: number) {
  // Acestream playback now routes through mpegts.js, so this config is
  // exclusively for normal IPTV / VOD HLS sources. Defaults are fine.
  const base = {
    abrEwmaDefaultEstimate: defaultEstimate,
    backBufferLength: 30,
    // Live channels start playing once we have this many fragments
    // buffered. 2 keeps start-up under a second for most IPTV CDNs; 4
    // added an avoidable ~3 seconds of "Loading..." before first frame.
    liveSyncDurationCount: 2,
    liveMaxLatencyDurationCount: 6,
    lowLatencyMode: false,
    // Per-fragment loader timeout. The old 60 s value masked dead streams;
    // 15 s is long enough for satellite IPTV CDNs and short enough that a
    // dead segment surfaces an error fast.
    fragLoadingTimeOut: 15_000,
    fragLoadingMaxRetry: 4,
    fragLoadingRetryDelay: 500,
    manifestLoadingTimeOut: 10_000,
    manifestLoadingMaxRetry: 2,
    manifestLoadingRetryDelay: 500,
    levelLoadingTimeOut: 10_000,
    levelLoadingMaxRetry: 4,
    levelLoadingRetryDelay: 500,
    // Start playback the moment we have enough — don't wait for a full
    // safety buffer when the user is hitting "channel up".
    startFragPrefetch: true,
    testBandwidth: false,
    enableWorker: true,
  };
  if (pref === "best") {
    return {
      ...base,
      startLevel: -1,
      capLevelToPlayerSize: false,
      abrBandWidthFactor: 0.95,
      abrBandWidthUpFactor: 0.9,
      maxBufferLength: 45,
      maxMaxBufferLength: 180,
    };
  }
  if (pref === "save") {
    return {
      ...base,
      startLevel: 0,
      capLevelToPlayerSize: true,
      abrBandWidthFactor: 0.7,
      abrBandWidthUpFactor: 0.5,
      maxBufferLength: 20,
      maxMaxBufferLength: 60,
    };
  }
  return {
    ...base,
    startLevel: 0,
    capLevelToPlayerSize: true,
    abrBandWidthFactor: 0.85,
    abrBandWidthUpFactor: 0.7,
    maxBufferLength: 30,
    maxMaxBufferLength: 120,
  };
}

function labelLevel(l: LevelInfo) {
  if (l.height > 0) return `${l.height}p`;
  if (l.bitrate > 0) return `${Math.round(l.bitrate / 1000)} kbps`;
  return `Variant ${l.index + 1}`;
}

function formatBytes(n: number | null | undefined) {
  if (!n || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status: string | null | undefined) {
  switch (status) {
    case "idle":
      return "Initialising";
    case "check":
      return "Checking content";
    case "starting":
      return "Starting session";
    case "prebuf":
      return "Prebuffering";
    case "buf":
      return "Buffering";
    case "dl":
    case "downloading":
      return "Streaming";
    case "err":
      return "Engine error";
    default:
      return status ?? null;
  }
}

function LoadingOverlay({
  channel,
  acePhase,
  aceStat,
}: {
  channel: ChannelRow | null;
  acePhase: "idle" | "preparing" | "polling" | "ready" | "error";
  aceStat: AcestreamStat | null;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    const start = Date.now();
    const t = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(t);
  }, [channel?.channel]);

  const isAcestream = channel?.source_id === "acestream";
  const label = channel?.name ?? channel?.channel ?? "stream";

  let phaseHeading = `Tuning in to ${label}…`;
  let subline: string | null = null;
  if (isAcestream) {
    if (acePhase === "preparing") {
      phaseHeading = `Asking engine to open ${label}…`;
      subline = "Starting playback session.";
    } else if (acePhase === "polling") {
      phaseHeading = `Connecting to peers for ${label}…`;
      const peers = aceStat?.peers ?? 0;
      const speed = aceStat?.speed_down ?? 0;
      const status = statusLabel(aceStat?.status);
      const parts: string[] = [];
      parts.push(`${peers} peer${peers === 1 ? "" : "s"}`);
      if (speed > 0) parts.push(`${speed.toFixed(0)} kB/s`);
      if (status) parts.push(status);
      subline = parts.join(" · ");
      if (elapsed >= 30 && peers === 0) {
        subline += " — still searching, give it a moment.";
      }
    } else if (acePhase === "ready") {
      phaseHeading = `Loading video for ${label}…`;
      subline = "Engine ready, attaching player.";
    }
  } else if (elapsed >= 8) {
    subline = "Still working — public streams can be slow at peak hours.";
  }

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 backdrop-blur-sm">
      <div className="flex max-w-md flex-col items-center gap-2 px-6 text-center">
        <Loader2 className="size-6 animate-spin text-white/80" />
        <div className="text-sm font-medium text-white">{phaseHeading}</div>
        {subline && <div className="text-xs text-white/65">{subline}</div>}
        {isAcestream && aceStat?.downloaded ? (
          <div className="text-[11px] text-white/45">
            {formatBytes(aceStat.downloaded)} buffered
          </div>
        ) : null}
        <div className="text-[11px] tabular-nums text-white/40">{elapsed}s</div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-white/55">{label}</span>
      <span className="font-mono text-white/85">{value}</span>
    </div>
  );
}

function fmtClock(unix: number) {
  const d = new Date(unix * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function NowPlayingStrip({
  title,
  start,
  stop,
  next,
  loading,
  available,
}: {
  title: string | null;
  start: number | null;
  stop: number | null;
  next: string | null;
  loading: boolean;
  available: boolean;
}) {
  if (!title && !next && !loading) {
    if (!available) {
      return (
        <div className="self-start rounded-lg bg-black/40 px-2.5 py-1 text-[11px] text-white/50 backdrop-blur-md">
          Program info isn't available for this channel
        </div>
      );
    }
    return null;
  }
  return (
    <div className="max-w-md self-start rounded-lg bg-black/45 px-3 py-1.5 backdrop-blur-md">
      {loading && !title ? (
        <div className="text-[11px] text-white/50">Loading guide…</div>
      ) : (
        <>
          {title && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
                Now
              </span>
              <span className="truncate text-xs font-medium text-white">
                {title}
              </span>
              {start !== null && stop !== null && (
                <span className="shrink-0 text-[10px] text-white/50">
                  {fmtClock(start)}–{fmtClock(stop)}
                </span>
              )}
            </div>
          )}
          {next && (
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
                Next
              </span>
              <span className="truncate text-[11px] text-white/70">{next}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function Player({
  channel,
  onClose,
  onToggleTheater,
  theater,
}: {
  channel: ChannelRow | null;
  onClose?: () => void;
  onToggleTheater?: () => void;
  theater?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<ReturnType<typeof mpegts.createPlayer> | null>(null);
  // Latest acestream session's command_url. We hand this to
  // cmd_acestream_stop_session on teardown so the engine actually releases
  // the session — without this, channel-hopping orphans sessions and
  // eventually exhausts the engine's session pool, making it unresponsive.
  const acestreamCommandUrlRef = useRef<string | null>(null);
  // Tracks whether the user *intentionally* paused (vs the video element
  // auto-pausing on a buffer underrun). Prevents the "keep PiP alive"
  // auto-resume from undoing a real user pause.
  const userPausedRef = useRef(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.9);
  const [isLive, setIsLive] = useState(true);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<number | null>(null);
  const [levels, setLevels] = useState<LevelInfo[]>([]);
  const [activeLevel, setActiveLevel] = useState<number>(-1);
  const [autoLevel, setAutoLevel] = useState<boolean>(true);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [airplayAvailable, setAirplayAvailable] = useState(false);
  // For mpegts.js sources (Acestream), capture the demuxed media metadata so
  // we can surface resolution/bitrate in the quality menu — switchable
  // qualities aren't available for raw TS streams (the source is single-
  // bitrate end-to-end), but showing what's playing is useful info.
  const [aceMediaInfo, setAceMediaInfo] = useState<{
    width?: number;
    height?: number;
    fps?: number;
    videoCodec?: string;
    audioCodec?: string;
    bitrate?: number;
  } | null>(null);
  const [acestreamStat, setAcestreamStat] = useState<AcestreamStat | null>(null);
  type AcePhase = "idle" | "preparing" | "polling" | "ready" | "error";
  const [acestreamPhase, setAcestreamPhaseState] = useState<AcePhase>("idle");
  const phaseRef = useRef<AcePhase>("idle");
  const setAcestreamPhase = (p: AcePhase) => {
    phaseRef.current = p;
    setAcestreamPhaseState(p);
  };

  const qualityPreference = useAppStore((s) => s.qualityPreference);

  const nowPlaying = useQuery({
    queryKey: ["nowPlaying", channel?.channel],
    queryFn: () => api.nowPlaying(channel!.channel),
    enabled: !!channel,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel) return;

    let disposed = false;
    let statPollTimer: number | null = null;
    setStatus("loading");
    setErrorMsg(null);
    setProgress(0);
    setDuration(0);
    setIsLive(true);
    setLevels([]);
    setActiveLevel(-1);
    setAutoLevel(true);
    setAcestreamStat(null);
    setAcestreamPhase("idle");
    setAceMediaInfo(null);

    const teardown = () => {
      if (statPollTimer) {
        window.clearTimeout(statPollTimer);
        statPollTimer = null;
      }
      if (hlsRef.current) {
        const interval = (hlsRef.current as unknown as {
          __diagInterval?: number;
        }).__diagInterval;
        if (interval) window.clearInterval(interval);
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (mpegtsRef.current) {
        try {
          mpegtsRef.current.pause();
          mpegtsRef.current.unload();
          mpegtsRef.current.detachMediaElement();
          mpegtsRef.current.destroy();
        } catch (e) {
          console.warn("[player] mpegts teardown error", e);
        }
        mpegtsRef.current = null;
      }
      // Best-effort engine session cleanup. Fire-and-forget so a slow stop
      // doesn't block the next channel from starting.
      const cmdUrl = acestreamCommandUrlRef.current;
      acestreamCommandUrlRef.current = null;
      if (cmdUrl) {
        api.acestreamStopSession(cmdUrl).catch(() => {});
      }
      video.removeAttribute("src");
      video.load();
    };
    teardown();

    const isAcestream = channel.source_id === "acestream";

    // For Acestream channels: kick off engine peer-discovery via /ace/getstream
    // and poll /ace/stat for live progress before letting hls.js touch the
    // manifest. The manifest endpoint stays blocked until the engine has
    // discovered enough peers, so without this the manifest XHR sits on a
    // 90-second TTFB timeout. Preflight gives the user real status (peers
    // found, download speed) and a fast hand-off to hls.js when ready.
    const startStatPolling = async (statUrl: string) => {
      const READY_STATUSES = new Set([
        "prebuf",
        "buf",
        "dl",
        "downloading",
      ]);
      const pollOnce = async () => {
        if (disposed) return;
        try {
          const stat = await api.acestreamStat(statUrl);
          if (disposed) return;
          setAcestreamStat(stat);
          if (stat.error) {
            setStatus("error");
            setErrorMsg(`Engine: ${stat.error}`);
            setAcestreamPhase("error");
            return;
          }
          const ready =
            stat.status &&
            READY_STATUSES.has(stat.status) &&
            (stat.peers ?? 0) > 0;
          if (ready) {
            setAcestreamPhase("ready");
            return; // attachHls will be called by the effect below
          }
        } catch (e) {
          console.warn("[player] stat poll failed", e);
        }
        if (!disposed) {
          statPollTimer = window.setTimeout(pollOnce, 2000);
        }
      };
      pollOnce();
    };

    (async () => {
      try {
        let manifestUrl = channel.url;

        if (isAcestream) {
          setAcestreamPhase("preparing");
          const idMatch = channel.channel.match(/^acestream\.([a-f0-9]{40})$/i);
          if (!idMatch) {
            throw new Error("missing acestream id on channel");
          }
          const contentId = idMatch[1];
          const prep = await api.acestreamPrepare(contentId);
          if (disposed) return;
          manifestUrl = prep.manifest_url;
          acestreamCommandUrlRef.current = prep.command_url;
          setAcestreamPhase("polling");
          startStatPolling(prep.stat_url);
          // Wait synchronously for the polling to mark the engine ready,
          // bounded by an absolute timeout so a dead channel surfaces as an
          // error instead of an infinite spinner.
          const readyDeadline = Date.now() + 5 * 60 * 1000;
          while (!disposed && Date.now() < readyDeadline) {
            // Check the latest phase state by reading from the closure-
            // captured state via a small wait — we use a ref-style trick by
            // re-checking acestreamPhase via setAcestreamPhase callback path.
            // Simpler: peek at the ready signal directly via another stat
            // call here, but startStatPolling already does that. So just
            // race against the polling loop.
            await new Promise((r) => setTimeout(r, 500));
            if (disposed) return;
            // Read phase via DOM-attribute trick? React state isn't readable
            // here without using a ref. Use a ref instead.
            if (phaseRef.current === "ready") break;
            if (phaseRef.current === "error") return;
          }
          if (disposed) return;
          if (phaseRef.current !== "ready") {
            setStatus("error");
            setErrorMsg(
              "Engine didn't find peers in time. The channel may be offline right now — try another stream.",
            );
            setAcestreamPhase("error");
            return;
          }
        }

        const proxied = await api.proxyUrl(
          manifestUrl,
          channel.referrer,
          channel.user_agent,
        );
        if (disposed) return;

        const isHls =
          channel.url.includes(".m3u8") || channel.url.includes("mpegurl");

        // Acestream channels deliver a continuous chunked MPEG-TS stream from
        // /ace/getstream. We use mpegts.js (Bilibili's TS-over-HTTP demuxer)
        // to transmux that into fMP4 for MSE — hls.js is the wrong tool for
        // a non-segmented infinite TS body and chokes in WKWebView. The
        // engine's `transcode_ac3=1` + `transcode_audio=1` query params (set
        // in build_stream_url) ensure audio comes out as AAC, which Chromium
        // / WKWebView's MSE can decode.
        if (isAcestream && mpegts.getFeatureList().mseLivePlayback) {
          const tag = "[player:diag]";
          const player = mpegts.createPlayer(
            {
              type: "mpegts",
              isLive: true,
              url: proxied,
            },
            {
              // Stability over low-latency: Acestream is a P2P swarm whose
              // throughput is bursty and ramps up over time. A deep stash
              // smooths bursts; chasing the live edge would constantly stall
              // when peer throughput dips below the channel bitrate.
              enableStashBuffer: true,
              // 4 MB initial stash → ~10 s of buffer at a ~3 Mbps HD stream.
              // Gives the engine room to grow the swarm before MSE under-runs.
              stashInitialSize: 4096,
              liveBufferLatencyChasing: false,
              // Keep MSE memory bounded — drop anything more than 30 s behind.
              autoCleanupSourceBuffer: true,
              autoCleanupMaxBackwardDuration: 30,
              autoCleanupMinBackwardDuration: 10,
              // Loader buffers help mpegts.js absorb chunked-TE jitter from
              // the proxy when peers come and go.
              lazyLoad: false,
              fixAudioTimestampGap: true,
              reuseRedirectedURL: true,
            },
          );
          mpegtsRef.current = player;

          player.on(mpegts.Events.MEDIA_INFO, (info) => {
            console.log(tag, "MEDIA_INFO", info);
            const i = info as Record<string, unknown>;
            setAceMediaInfo({
              width: typeof i.width === "number" ? i.width : undefined,
              height: typeof i.height === "number" ? i.height : undefined,
              fps: typeof i.fps === "number" ? i.fps : undefined,
              videoCodec:
                typeof i.videoCodec === "string" ? i.videoCodec : undefined,
              audioCodec:
                typeof i.audioCodec === "string" ? i.audioCodec : undefined,
              bitrate: typeof i.bitrate === "number" ? i.bitrate : undefined,
            });
          });
          player.on(mpegts.Events.METADATA_ARRIVED, (md) => {
            console.log(tag, "METADATA_ARRIVED", md);
          });
          player.on(mpegts.Events.LOADING_COMPLETE, () => {
            console.log(tag, "LOADING_COMPLETE");
          });
          player.on(mpegts.Events.RECOVERED_EARLY_EOF, () => {
            console.warn(tag, "RECOVERED_EARLY_EOF — stream cut, recovered");
          });
          player.on(mpegts.Events.STATISTICS_INFO, (s) => {
            // Log occasionally; this fires per-fragment so guard with a
            // simple counter on the player instance.
            const ext = player as unknown as { __statTick?: number };
            ext.__statTick = (ext.__statTick ?? 0) + 1;
            if (ext.__statTick % 10 === 0) {
              console.log(tag, "STATISTICS_INFO", s);
            }
          });
          player.on(mpegts.Events.ERROR, (errType, errDetail, errInfo) => {
            console.error(tag, "mpegts ERROR", errType, errDetail, errInfo);
            if (channel) {
              api.healthRecordFail(channel.channel, channel.url).catch(() => {});
            }
            setErrorMsg(`${errType}: ${errDetail}`);
            setStatus("error");
          });

          // Once the video element has metadata we know the demuxer/MSE
          // pipeline is working — flip status and start playback.
          const onLoadedMeta = () => {
            console.log(tag, "video loadedmetadata (mpegts)");
            setStatus("playing");
            setIsLive(true);
            if (channel) {
              api
                .healthRecordOk(channel.channel, channel.url)
                .catch(() => {});
            }
            video.play().then(
              () => console.log(tag, "video.play OK (mpegts)"),
              (err) =>
                console.warn(
                  tag,
                  "video.play REJECTED (mpegts)",
                  err?.name,
                  err?.message,
                ),
            );
          };
          video.addEventListener("loadedmetadata", onLoadedMeta, {
            once: true,
          });

          player.attachMediaElement(video);
          player.load();
          return;
        }

        if (isHls && Hls.isSupported()) {
          const hls = new Hls(configFor(qualityPreference, lastBandwidth()));
          hlsRef.current = hls;

          // --- diagnostic instrumentation ---------------------------------
          // Goal: identify whether playback breaks at network (segment 302
          // fails / blocked) or at codec/MSE (fragments load but won't
          // append). Once we know which, we can fix targeted.
          const tag = "[player:diag]";
          let fragsLoaded = 0;
          let appended = 0;
          hls.on(Hls.Events.MANIFEST_LOADING, (_e, d) => {
            console.log(tag, "MANIFEST_LOADING", d.url);
          });
          hls.on(Hls.Events.MANIFEST_LOADED, (_e, d) => {
            console.log(tag, "MANIFEST_LOADED", {
              url: d.url,
              levels: d.levels.length,
              levelDetails: d.levels.map((l) => ({
                bitrate: l.bitrate,
                attrs: l.attrs,
              })),
            });
          });
          hls.on(Hls.Events.LEVEL_LOADED, (_e, d) => {
            console.log(tag, "LEVEL_LOADED", {
              live: d.details?.live,
              fragments: d.details?.fragments?.length,
              targetduration: d.details?.targetduration,
              firstFragUrl: d.details?.fragments?.[0]?.url,
            });
          });
          hls.on(Hls.Events.FRAG_LOADING, (_e, d) => {
            console.log(tag, "FRAG_LOADING", {
              sn: d.frag.sn,
              url: d.frag.url,
              type: d.frag.type,
            });
          });
          hls.on(Hls.Events.FRAG_LOADED, (_e, d) => {
            fragsLoaded++;
            console.log(tag, "FRAG_LOADED", {
              n: fragsLoaded,
              sn: d.frag.sn,
              size: d.payload?.byteLength ?? 0,
            });
          });
          hls.on(Hls.Events.FRAG_PARSING_INIT_SEGMENT, (_e, d) => {
            console.log(tag, "FRAG_PARSING_INIT_SEGMENT", d);
          });
          hls.on(Hls.Events.BUFFER_CODECS, (_e, d) => {
            console.log(tag, "BUFFER_CODECS", d);
          });
          hls.on(Hls.Events.BUFFER_APPENDING, (_e, d) => {
            console.log(tag, "BUFFER_APPENDING", {
              type: d.type,
              size: d.data?.byteLength,
            });
          });
          hls.on(Hls.Events.BUFFER_APPENDED, (_e, d) => {
            appended++;
            console.log(tag, "BUFFER_APPENDED", {
              n: appended,
              type: d.type,
              timeRanges: Object.fromEntries(
                Object.entries(d.timeRanges ?? {}).map(([k, tr]) => [
                  k,
                  Array.from({ length: tr.length }, (_, i) => [
                    tr.start(i),
                    tr.end(i),
                  ]),
                ]),
              ),
            });
          });
          // Surface video element state alongside hls state — `video.error`
          // tells us if MediaSource itself rejected the stream, and
          // readyState/networkState pinpoint MSE stalls.
          const videoStateLog = window.setInterval(() => {
            if (!videoRef.current) return;
            const v = videoRef.current;
            const buffered = Array.from(
              { length: v.buffered.length },
              (_, i) => [v.buffered.start(i), v.buffered.end(i)],
            );
            console.log(tag, "VIDEO_STATE", {
              readyState: v.readyState,
              networkState: v.networkState,
              currentTime: v.currentTime,
              paused: v.paused,
              ended: v.ended,
              error: v.error
                ? { code: v.error.code, message: v.error.message }
                : null,
              buffered,
              fragsLoaded,
              appended,
            });
          }, 3000);
          (hls as unknown as { __diagInterval?: number }).__diagInterval =
            videoStateLog;

          hls.on(Hls.Events.ERROR, (_e, data: ErrorData) => {
            // Acestream often emits non-fatal manifest/level/frag load errors
            // during the cold-start window — log them so we can see retries
            // happening, but only break the player on fatal errors.
            if (!data.fatal) {
              console.warn(tag, "non-fatal", data.type, data.details, {
                reason: data.reason,
                response: data.response,
                frag: data.frag?.url,
              });
              return;
            }
            console.error(tag, "FATAL", data.type, data.details, data);
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              if (channel) {
                api
                  .healthRecordFail(channel.channel, channel.url)
                  .catch(() => {});
              }
              setErrorMsg(data.details || "playback error");
              setStatus("error");
              hls.destroy();
            }
          });

          hls.on(Hls.Events.FRAG_LOADED, () => {
            const estimate = (hls as unknown as { bandwidthEstimate?: number })
              .bandwidthEstimate;
            if (estimate && estimate > 0) {
              localStorage.setItem(BANDWIDTH_KEY, String(Math.round(estimate)));
            }
          });

          hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => {
            const live = data.details?.live ?? true;
            setIsLive(live);
          });

          hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
            const ls: LevelInfo[] = (data.levels ?? []).map((lvl, index) => ({
              index,
              height: lvl.height ?? 0,
              bitrate: lvl.bitrate ?? 0,
            }));
            console.log(tag, "MANIFEST_PARSED", {
              levels: ls,
              audioTracks: data.audioTracks?.length,
              firstLevelCodecs: data.levels?.[0]?.codecs,
            });
            setLevels(ls);
            setStatus("playing");
            if (channel) {
              api
                .healthRecordOk(channel.channel, channel.url)
                .catch(() => {});
            }
            video.play().then(
              () => console.log(tag, "video.play OK"),
              (err) =>
                console.warn(tag, "video.play REJECTED", err?.name, err?.message),
            );
          });

          hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
            setActiveLevel(data.level);
          });

          hls.loadSource(proxied);
          hls.attachMedia(video);
        } else {
          video.src = proxied;
          video.addEventListener(
            "loadedmetadata",
            () => {
              setStatus("playing");
              setIsLive(!Number.isFinite(video.duration));
              video.play().catch(() => {});
            },
            { once: true },
          );
          video.addEventListener(
            "error",
            () => {
              setStatus("error");
              setErrorMsg("native playback failed");
            },
            { once: true },
          );
        }
      } catch (e) {
        if (disposed) return;
        setStatus("error");
        setErrorMsg(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      disposed = true;
      teardown();
    };
  }, [channel?.channel, channel?.url, qualityPreference]);

  const pickLevel = (index: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = index;
    setAutoLevel(index === -1);
    if (index === -1) hls.nextLevel = -1;
    setShowQualityMenu(false);
  };

  const sortedLevels = [...levels].sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
  const activeLabel = autoLevel
    ? "Auto"
    : activeLevel >= 0 && levels[activeLevel]
      ? labelLevel(levels[activeLevel])
      : "Auto";

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => {
      setPaused(false);
      setStalled(false);
    };
    const onPause = () => setPaused(true);
    const onTime = () => {
      setProgress(video.currentTime);
      if (Number.isFinite(video.duration)) {
        setDuration(video.duration);
        setIsLive(false);
      } else {
        setIsLive(true);
      }
      // Once we're advancing again, clear the stalled badge.
      setStalled(false);
    };
    // Stall handlers also re-arm playback. WKWebView closes Picture-in-
    // Picture when the underlying video transitions to paused for too
    // long, and bursty P2P throughput causes brief MSE underruns where
    // the element pauses itself. Re-calling play() doesn't hurt if there's
    // no buffer (browser queues it) and prevents PiP from giving up.
    const onWaiting = () => {
      setStalled(true);
      if (!userPausedRef.current) video.play().catch(() => {});
    };
    const onPlaying = () => setStalled(false);
    const onStalled = () => {
      setStalled(true);
      if (!userPausedRef.current) video.play().catch(() => {});
    };
    const onLeavePip = () => {
      console.log("[player:diag] leftpictureinpicture");
    };
    const onEnterPip = () => {
      console.log("[player:diag] enteredpictureinpicture");
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("durationchange", onTime);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("leavepictureinpicture", onLeavePip);
    video.addEventListener("enterpictureinpicture", onEnterPip);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("durationchange", onTime);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("leavepictureinpicture", onLeavePip);
      video.removeEventListener("enterpictureinpicture", onEnterPip);
    };
  }, []);

  useEffect(() => {
    return onFullscreenChange(() => setIsFullscreen(docIsFullscreen()));
  }, []);

  // AirPlay availability is a WebKit-only feature. The video element fires
  // `webkitplaybacktargetavailabilitychanged` when AirPlay receivers come
  // and go on the local network. We only show the AirPlay button when at
  // least one is reachable AND the source isn't Acestream (whose stream
  // URL is on 127.0.0.1 and can't be reached by an Apple TV).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // x-webkit-airplay enables AirPlay route advertising. React doesn't
    // pass hyphenated non-standard attrs through JSX, so set it manually.
    if (!video.hasAttribute("x-webkit-airplay")) {
      video.setAttribute("x-webkit-airplay", "allow");
    }
    const v = video as HTMLVideoElement & {
      webkitShowPlaybackTargetPicker?: () => void;
    };
    const onAvail = (e: Event) => {
      const evt = e as Event & { availability?: string };
      setAirplayAvailable(evt.availability === "available");
    };
    if (typeof v.webkitShowPlaybackTargetPicker === "function") {
      video.addEventListener(
        "webkitplaybacktargetavailabilitychanged" as keyof HTMLVideoElementEventMap,
        onAvail as EventListener,
      );
    }
    return () => {
      video.removeEventListener(
        "webkitplaybacktargetavailabilitychanged" as keyof HTMLVideoElementEventMap,
        onAvail as EventListener,
      );
    };
  }, []);

  const showAirplayPicker = () => {
    const v = videoRef.current as
      | (HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void })
      | null;
    if (v?.webkitShowPlaybackTargetPicker) {
      try {
        v.webkitShowPlaybackTargetPicker();
      } catch (e) {
        console.warn("[player] AirPlay picker failed", e);
      }
    }
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
  }, [volume, muted]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      userPausedRef.current = false;
      v.play().catch(() => {});
    } else {
      userPausedRef.current = true;
      v.pause();
    }
  };

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    if (docIsFullscreen()) {
      await exitFullscreen();
    } else {
      await requestFullscreen(el);
    }
  };

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v || isLive) return;
    v.currentTime = t;
  };

  const showAndScheduleHide = () => {
    setShowControls(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (!paused) {
      hideTimer.current = window.setTimeout(() => setShowControls(false), 2400);
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={showAndScheduleHide}
      onMouseLeave={() => !paused && setShowControls(false)}
      className={cn(
        "group relative h-full w-full overflow-hidden bg-black",
        theater ? "" : "rounded-2xl border border-white/10",
      )}
    >
      <video
        ref={videoRef}
        onClick={togglePlay}
        className="h-full w-full bg-black"
        playsInline
        preload="auto"
        // iPad WKWebView auto-PiPs an inline <video> on background only
        // when these attributes are set. React's typings don't expose
        // `autopictureinpicture` yet, so spread it in untyped.
        {...({ autopictureinpicture: "", "x-webkit-airplay": "allow" } as Record<string, string>)}
      />

      {channel && (
        <div
          className={cn(
            // z-30 keeps the close + title strip above the LoadingOverlay
            // (z-20) so the user can always abort a slow tune-in. The
            // overlay's full-width backdrop sits between the video element
            // and these controls.
            "pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-3 transition-opacity duration-300",
            status === "loading" || showControls ? "opacity-100" : "opacity-0",
          )}
        >
          <div className="pointer-events-auto flex max-w-[80%] flex-col gap-1.5">
            <div className="flex items-center gap-2 self-start rounded-full bg-black/45 px-3 py-1.5 backdrop-blur-md">
              {isLive && (
                <span className="flex items-center gap-1.5 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300">
                  <span className="size-1.5 animate-pulse rounded-full bg-red-400" />
                  Live
                </span>
              )}
              <span className="text-sm font-medium text-white">
                {channel.name ?? channel.channel}
              </span>
              {channel.quality && (
                <span className="text-[10px] uppercase tracking-wide text-white/50">
                  {channel.quality}
                </span>
              )}
            </div>
            <NowPlayingStrip
              title={nowPlaying.data?.current?.title ?? null}
              start={nowPlaying.data?.current?.start_at ?? null}
              stop={nowPlaying.data?.current?.stop_at ?? null}
              next={nowPlaying.data?.next?.title ?? null}
              loading={nowPlaying.isLoading}
              available={nowPlaying.data?.available ?? false}
            />
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="pointer-events-auto rounded-full bg-black/40 p-2 text-white/70 backdrop-blur-md hover:bg-black/60 hover:text-white"
              aria-label="Close player"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      )}

      {channel && (
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2 bg-linear-to-t from-black/85 via-black/40 to-transparent px-4 pb-3 pt-10 transition-opacity duration-300",
            showControls ? "opacity-100" : "opacity-0",
          )}
        >
          {!isLive && (
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={progress}
              onChange={(e) => seek(Number(e.target.value))}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-cyan-300"
            />
          )}
          <div className="flex items-center gap-3 text-white">
            <button
              onClick={togglePlay}
              className="rounded-full p-2 hover:bg-white/15"
              aria-label={paused ? "Play" : "Pause"}
            >
              {paused ? <Play className="size-5" /> : <Pause className="size-5" />}
            </button>

            <button
              onClick={() => setMuted((m) => !m)}
              className="rounded-full p-2 hover:bg-white/15"
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                if (v > 0) setMuted(false);
              }}
              className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-white/15 accent-cyan-300"
            />

            <div className="ml-2 text-xs text-white/70 tabular-nums">
              {isLive ? (
                <span className="flex items-center gap-1">
                  <Radio className="size-3" />
                  Live
                </span>
              ) : (
                <span>
                  {fmtTime(progress)} / {fmtTime(duration)}
                </span>
              )}
            </div>

            <div className="ml-auto" />

            {levels.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowQualityMenu((s) => !s)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium hover:bg-white/15"
                  aria-label="Quality"
                  title="Stream quality"
                >
                  <Gauge className="size-3.5" />
                  {activeLabel}
                </button>
                {showQualityMenu && (
                  <div className="absolute bottom-full right-0 mb-2 min-w-35 overflow-hidden rounded-xl border border-white/10 bg-neutral-900/95 backdrop-blur-xl">
                    <button
                      onClick={() => pickLevel(-1)}
                      className={cn(
                        "flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-white/10",
                        autoLevel && "text-cyan-200",
                      )}
                    >
                      <span>Auto</span>
                      <span className="text-[10px] text-white/40">
                        {autoLevel && activeLevel >= 0 && levels[activeLevel]
                          ? `· ${labelLevel(levels[activeLevel])}`
                          : ""}
                      </span>
                    </button>
                    {sortedLevels.map((l) => (
                      <button
                        key={l.index}
                        onClick={() => pickLevel(l.index)}
                        className={cn(
                          "flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-white/10",
                          !autoLevel && activeLevel === l.index && "text-cyan-200",
                        )}
                      >
                        <span>{labelLevel(l)}</span>
                        {l.bitrate > 0 && (
                          <span className="text-[10px] text-white/40">
                            {Math.round(l.bitrate / 1000)}k
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Acestream is single-bitrate end-to-end (the engine doesn't
                transcode to multiple variants), so we can't offer
                switchable qualities. We show the actual resolution / FPS /
                codec the demuxer reports as a read-only indicator. */}
            {channel?.source_id === "acestream" && aceMediaInfo && (
              <div className="relative">
                <button
                  onClick={() => setShowQualityMenu((s) => !s)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium hover:bg-white/15"
                  aria-label="Stream info"
                  title="Stream info (Acestream sources are single-bitrate)"
                >
                  <Gauge className="size-3.5" />
                  {aceMediaInfo.height
                    ? `${aceMediaInfo.height}p`
                    : aceMediaInfo.bitrate
                      ? `${Math.round(aceMediaInfo.bitrate)} kbps`
                      : "Live"}
                </button>
                {showQualityMenu && (
                  <div className="absolute bottom-full right-0 mb-2 min-w-56 overflow-hidden rounded-xl border border-white/10 bg-neutral-900/95 p-3 text-xs backdrop-blur-xl">
                    <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5">
                      Stream info
                    </div>
                    <div className="space-y-1">
                      {aceMediaInfo.width && aceMediaInfo.height && (
                        <Row
                          label="Resolution"
                          value={`${aceMediaInfo.width}×${aceMediaInfo.height}${
                            aceMediaInfo.fps
                              ? ` @ ${Math.round(aceMediaInfo.fps)}fps`
                              : ""
                          }`}
                        />
                      )}
                      {aceMediaInfo.videoCodec && (
                        <Row
                          label="Video codec"
                          value={aceMediaInfo.videoCodec}
                        />
                      )}
                      {aceMediaInfo.audioCodec && (
                        <Row
                          label="Audio codec"
                          value={aceMediaInfo.audioCodec}
                        />
                      )}
                      {aceMediaInfo.bitrate && (
                        <Row
                          label="Bitrate"
                          value={`${Math.round(aceMediaInfo.bitrate)} kbps`}
                        />
                      )}
                      {acestreamStat?.peers ? (
                        <Row
                          label="Peers"
                          value={`${acestreamStat.peers}${
                            acestreamStat.speed_down
                              ? ` · ${Math.round(acestreamStat.speed_down)} kB/s`
                              : ""
                          }`}
                        />
                      ) : null}
                    </div>
                    <p className="mt-2 text-[10px] text-white/40">
                      Acestream channels are single-bitrate. To get a
                      different quality, pick a different channel variant
                      (e.g. SD vs HD) from the channel browser.
                    </p>
                  </div>
                )}
              </div>
            )}

            {onToggleTheater && (
              <button
                onClick={onToggleTheater}
                className="rounded-full p-2 hover:bg-white/15"
                aria-label={theater ? "Exit theater" : "Theater mode"}
                title={theater ? "Exit theater (Esc)" : "Theater mode"}
              >
                <Monitor className="size-4" />
              </button>
            )}

            {airplayAvailable && channel?.source_id !== "acestream" && (
              <button
                onClick={showAirplayPicker}
                className="rounded-full p-2 hover:bg-white/15"
                aria-label="AirPlay"
                title="AirPlay to TV / speaker"
              >
                <Cast className="size-4" />
              </button>
            )}

            {supportsVideoPip() && (
              <button
                onClick={() => {
                  const v = videoRef.current;
                  if (v) toggleVideoPip(v);
                }}
                className="rounded-full p-2 hover:bg-white/15"
                aria-label="Picture in picture"
                title="Picture in picture"
              >
                <PictureInPicture2 className="size-4" />
              </button>
            )}

            <button
              onClick={toggleFullscreen}
              className="rounded-full p-2 hover:bg-white/15"
              aria-label="Fullscreen"
              title="Fullscreen"
            >
              {isFullscreen ? (
                <Minimize2 className="size-4" />
              ) : (
                <Maximize2 className="size-4" />
              )}
            </button>
          </div>
        </div>
      )}

      {status === "loading" && (
        <LoadingOverlay
          channel={channel}
          acePhase={acestreamPhase}
          aceStat={acestreamStat}
        />
      )}
      {status === "playing" && stalled && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
          <div className="flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white/85 backdrop-blur-md">
            <Loader2 className="size-3.5 animate-spin" />
            Buffering…
          </div>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass max-w-md rounded-xl p-5 text-center">
            <AlertTriangle className="mx-auto mb-2 size-6 text-amber-300" />
            <p className="font-semibold">This channel isn't available right now</p>
            <p className="mt-1 text-sm text-white/60">{errorMsg}</p>
            <p className="mt-2 text-xs text-white/40">Try a different channel — public IPTV streams come and go.</p>
          </div>
        </div>
      )}
      {!channel && (
        <div className="absolute inset-0 flex items-center justify-center text-white/50">
          Pick a channel to start watching
        </div>
      )}
    </div>
  );
}
