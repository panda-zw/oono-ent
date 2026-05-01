import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Play, RefreshCw, Search, ShieldCheck, Star, Volume2 } from "lucide-react";
import { api } from "@/api";
import type { RadioStation } from "@/types";
import { useAppStore } from "@/store";
import { cn } from "@/lib/utils";

export function RadioPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const current = useAppStore((s) => s.radioCurrent);
  const setCurrent = useAppStore((s) => s.setRadioCurrent);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const list = useQuery({
    queryKey: ["radio", "list", debounced],
    queryFn: () => api.radioList(debounced || undefined),
  });

  const refresh = useMutation({
    mutationFn: api.radioRefresh,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radio"] }),
  });

  useEffect(() => {
    if (list.data && list.data.length === 0 && !refresh.isPending) {
      refresh.mutate();
    }
  }, [list.data]);

  const setFav = useMutation({
    mutationFn: ({ uuid, favorite }: { uuid: string; favorite: boolean }) =>
      api.radioSetFavorite(uuid, favorite),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radio"] }),
  });

  return (
    <div className="@container flex h-full flex-col gap-4 overflow-y-auto p-6 pb-32">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold @lg:text-3xl">Radio</h1>
          <p className="text-sm text-white/60">
            Zimbabwean stations from radio-browser, plus your favourites.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search stations…"
              className="w-64 rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/40 focus:border-cyan-300/50 focus:outline-none"
            />
          </div>
          <button
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="glass glass-hover inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm"
          >
            <RefreshCw
              className={cn("size-4", refresh.isPending && "animate-spin")}
            />
            Refresh
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-2 @md:grid-cols-2 @xl:grid-cols-3">
        {list.data?.map((s) => (
          <RadioCard
            key={s.uuid}
            station={s}
            playing={current?.uuid === s.uuid}
            onPlay={() => setCurrent(s)}
            onToggleFavorite={() =>
              setFav.mutate({ uuid: s.uuid, favorite: !s.favorite })
            }
          />
        ))}
        {list.data && list.data.length === 0 && !refresh.isPending && (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-white/50 @md:col-span-2 @xl:col-span-3">
            No stations yet. Refreshing the directory…
          </div>
        )}
      </section>
    </div>
  );
}

function RadioCard({
  station,
  playing,
  onPlay,
  onToggleFavorite,
}: {
  station: RadioStation;
  playing: boolean;
  onPlay: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-xl border p-3 transition-colors",
        playing
          ? "border-cyan-300/40 bg-cyan-300/10"
          : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10",
      )}
    >
      <button
        onClick={station.last_check_ok ? onPlay : undefined}
        disabled={!station.last_check_ok}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 text-left",
          !station.last_check_ok && "cursor-not-allowed",
        )}
      >
        <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/10">
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
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-white">{station.name}</span>
            {station.curated && (
              <ShieldCheck className="size-3 shrink-0 text-cyan-300" aria-label="Curated Zimbabwe station" />
            )}
            {!station.last_check_ok && (
              <AlertTriangle className="size-3 shrink-0 text-amber-300" aria-label="Stream offline" />
            )}
          </div>
          <div className="truncate text-xs text-white/50">
            {!station.last_check_ok
              ? "Stream temporarily offline"
              : [
                  station.codec,
                  station.bitrate ? `${station.bitrate}kbps` : null,
                  station.tags.slice(0, 2).join(", "),
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </div>
        </div>
      </button>
      <button
        onClick={onToggleFavorite}
        className={cn(
          "rounded-md p-1.5 transition-colors",
          station.favorite
            ? "text-amber-300"
            : "text-white/30 opacity-0 hover:bg-white/10 hover:text-amber-300 group-hover:opacity-100",
        )}
        title="Favorite"
      >
        <Star className="size-4" fill={station.favorite ? "currentColor" : "none"} />
      </button>
      <button
        onClick={onPlay}
        disabled={!station.last_check_ok}
        className="rounded-full bg-cyan-300/20 p-2 text-cyan-100 hover:bg-cyan-300/30 disabled:opacity-30"
        title={station.last_check_ok ? "Play" : "Stream temporarily offline"}
      >
        <Play className="size-4" fill="currentColor" />
      </button>
    </div>
  );
}
