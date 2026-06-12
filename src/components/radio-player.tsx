import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { api } from "@/api";
import { useAppStore } from "@/store";

export function RadioPlayer() {
  const station = useAppStore((s) => s.radioCurrent);
  const setStation = useAppStore((s) => s.setRadioCurrent);
  const volume = useAppStore((s) => s.radioVolume);
  const setVolume = useAppStore((s) => s.setRadioVolume);
  const muted = useAppStore((s) => s.radioMuted);
  const setMuted = useAppStore((s) => s.setRadioMuted);

  const audioRef = useRef<HTMLAudioElement>(null);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (!station) {
      a.pause();
      a.removeAttribute("src");
      a.load();
      setError(null);
      return;
    }
    setError(null);
    setPaused(false);
    const rawUrl = station.url_resolved || station.url;
    const apply = (src: string) => {
      a.src = src;
      a.volume = volume;
      a.muted = muted;
      a.play().catch((e) => setError(`Playback failed: ${e.message ?? e}`));
    };
    // Stations that need Origin/Referer (Zeno.fm, etc.) go through the local
    // Rust proxy which injects those headers — <audio> can't set them itself.
    if (station.referer || station.user_agent) {
      api
        .proxyUrl(rawUrl, station.referer, station.user_agent)
        .then(apply)
        .catch((e) => setError(`Proxy failed: ${e}`));
    } else {
      apply(rawUrl);
    }
    api.radioClick(station.uuid).catch(() => {});
  }, [station?.uuid]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = volume;
    a.muted = muted;
  }, [volume, muted]);

  if (!station) return null;

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  return (
    <div className="pb-safe-2 pointer-events-auto fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-neutral-950/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 p-3">
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/10">
          {station.favicon ? (
            <img
              src={station.favicon}
              alt=""
              className="size-full object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <Volume2 className="size-5 text-white/60" />
          )}
        </div>
        <button
          onClick={togglePlay}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cyan-300/20 text-cyan-100 hover:bg-cyan-300/30"
          title={paused ? "Play" : "Pause"}
        >
          {paused ? (
            <Play className="size-5" fill="currentColor" />
          ) : (
            <Pause className="size-5" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white">
            {station.name}
          </div>
          <div className="truncate text-xs text-white/50">
            {error
              ? error
              : [
                  station.codec,
                  station.bitrate ? `${station.bitrate}kbps` : null,
                  station.tags.slice(0, 2).join(", "),
                ]
                  .filter(Boolean)
                  .join(" · ") || "Streaming…"}
          </div>
        </div>
        <button
          onClick={() => setMuted(!muted)}
          className="rounded-full p-2 text-white/70 hover:bg-white/10"
          title={muted ? "Unmute" : "Mute"}
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
          className="h-1 w-28 cursor-pointer appearance-none rounded-full bg-white/15 accent-cyan-300"
        />
        <button
          onClick={() => setStation(null)}
          className="rounded-full p-2 text-white/70 hover:bg-white/10"
          title="Stop and close"
        >
          <X className="size-4" />
        </button>
      </div>
      <audio
        ref={audioRef}
        onPause={() => setPaused(true)}
        onPlay={() => setPaused(false)}
        onError={() => setError("Stream offline or blocked")}
      />
    </div>
  );
}
