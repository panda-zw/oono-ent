import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  ExternalLink,
  Film,
  Play,
  Star,
  Tv as TvIcon,
} from "lucide-react";
import { api } from "@/api";
import type { PosterCard } from "@/types";
import { tmdbImage } from "@/lib/tmdb";
import { cn } from "@/lib/utils";

export function PosterRow({
  title,
  items,
  loading,
}: {
  title: string;
  items: PosterCard[] | undefined;
  loading?: boolean;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="-mx-2 flex gap-3 overflow-x-auto px-2 pb-3">
        {loading && !items && (
          <>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-56 w-36 shrink-0 animate-pulse rounded-xl bg-white/5"
              />
            ))}
          </>
        )}
        {items?.map((item) => (
          <PosterTile key={item.id} item={item} />
        ))}
        {items && items.length === 0 && !loading && (
          <div className="text-sm text-white/50">Nothing here yet.</div>
        )}
      </div>
    </section>
  );
}

// Maps ISO 639-1 codes used by TMDB to short, recognisable display labels.
// We only render badges for non-English originals (English content is the
// vast majority and crowding every card with "EN" adds noise) plus a
// "DUB" hint when needed.
const LANG_LABELS: Record<string, string> = {
  ja: "JP",
  ko: "KR",
  zh: "ZH",
  cn: "ZH",
  hi: "HI",
  ta: "TA",
  te: "TE",
  ml: "ML",
  fr: "FR",
  es: "ES",
  pt: "PT",
  it: "IT",
  de: "DE",
  ru: "RU",
  ar: "AR",
  tr: "TR",
  th: "TH",
  vi: "VI",
  id: "ID",
  pl: "PL",
  nl: "NL",
  sv: "SV",
  no: "NO",
  da: "DA",
  fi: "FI",
  he: "HE",
  fa: "FA",
  ur: "UR",
  bn: "BN",
  uk: "UK",
  el: "EL",
  cs: "CS",
  hu: "HU",
  ro: "RO",
};

function languageBadge(item: PosterCard): string | null {
  const code = item.original_language?.toLowerCase();
  if (!code || code === "en") return null;
  return LANG_LABELS[code] ?? code.toUpperCase().slice(0, 2);
}

export function PosterTile({
  item,
  size = "default",
}: {
  item: PosterCard;
  size?: "default" | "small" | "fill";
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const url = tmdbImage(item.poster_path, "w342");
  const fill = size === "fill";
  const w = fill ? "w-full" : size === "small" ? "w-28" : "w-36";
  const h = fill
    ? "aspect-[2/3]"
    : size === "small"
      ? "h-44"
      : "h-56";
  const lang = languageBadge(item);
  const detailHref = `/${item.kind === "tv" ? "series" : "movies"}/${item.tmdb_id}`;
  const watchHref =
    item.kind === "movie"
      ? `/watch/movie/${item.tmdb_id}`
      : null;

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const inWatchlist = useQuery({
    queryKey: ["vod", "watchlist", "has", item.id],
    queryFn: () => api.vodWatchlistHas(item.id),
    // Only run the lookup when the user actually opens the menu — prefetching
    // for every poster on screen would hammer SQLite for nothing.
    enabled: menu !== null,
    staleTime: 30_000,
  });

  const addWatchlist = useMutation({
    mutationFn: () => api.vodWatchlistAdd(item.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vod", "watchlist"] });
    },
  });
  const removeWatchlist = useMutation({
    mutationFn: () => api.vodWatchlistRemove(item.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vod", "watchlist"] });
    },
  });
  const markCompleted = useMutation({
    mutationFn: () => api.vodMarkCompleted(item.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vod", "continueWatching"] });
    },
  });

  const open = () => navigate(detailHref);

  return (
    <>
      <div
        onClick={open}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        className={cn(
          "group flex cursor-pointer flex-col gap-1.5 text-left",
          fill ? "w-full" : "shrink-0",
          w,
        )}
      >
        <div className={cn("relative overflow-hidden rounded-xl border border-white/10 bg-white/5", h)}>
          {url ? (
            <img
              src={url}
              alt={item.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-white/30">
              {item.kind === "tv" ? (
                <TvIcon className="size-8" />
              ) : (
                <Film className="size-8" />
              )}
            </div>
          )}
          {item.vote_average !== null && item.vote_average > 0 && (
            <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
              <Star className="size-2.5 fill-amber-300 text-amber-300" />
              {item.vote_average.toFixed(1)}
            </div>
          )}
          {lang && (
            <div
              className="absolute left-1.5 top-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-white/90 backdrop-blur"
              title={`Original language: ${item.original_language}`}
            >
              {lang}
            </div>
          )}
        </div>
        <div className="px-0.5">
          <div className="truncate text-sm font-medium text-white">{item.title}</div>
          {item.release_date && (
            <div className="text-[11px] text-white/50">
              {item.release_date.slice(0, 4)}
            </div>
          )}
        </div>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          inWatchlist={inWatchlist.data ?? false}
          onOpen={open}
          onWatchNow={
            watchHref ? () => navigate(watchHref) : undefined
          }
          onToggleWatchlist={() => {
            if (inWatchlist.data) removeWatchlist.mutate();
            else addWatchlist.mutate();
          }}
          onMarkCompleted={() => markCompleted.mutate()}
        />
      )}
    </>
  );
}

function ContextMenu({
  x,
  y,
  onClose,
  inWatchlist,
  onOpen,
  onWatchNow,
  onToggleWatchlist,
  onMarkCompleted,
}: {
  x: number;
  y: number;
  onClose: () => void;
  inWatchlist: boolean;
  onOpen: () => void;
  onWatchNow?: () => void;
  onToggleWatchlist: () => void;
  onMarkCompleted: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Clamp menu inside the viewport once it has measured itself.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const padding = 8;
    let left = x;
    let top = y;
    if (left + r.width + padding > window.innerWidth) {
      left = window.innerWidth - r.width - padding;
    }
    if (top + r.height + padding > window.innerHeight) {
      top = window.innerHeight - r.height - padding;
    }
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    // Full-screen catcher so any click outside the menu closes it.
    <div
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="fixed inset-0 z-100"
    >
      <div
        ref={ref}
        onClick={(e) => e.stopPropagation()}
        style={{ left: pos.left, top: pos.top }}
        className="absolute min-w-52 overflow-hidden rounded-xl border border-white/10 bg-neutral-900/95 py-1 text-sm shadow-2xl backdrop-blur-xl"
      >
        {onWatchNow && (
          <MenuItem
            icon={<Play className="size-3.5" fill="currentColor" />}
            onClick={() => {
              onWatchNow();
              onClose();
            }}
          >
            Watch now
          </MenuItem>
        )}
        <MenuItem
          icon={<ExternalLink className="size-3.5" />}
          onClick={() => {
            onOpen();
            onClose();
          }}
        >
          Open details
        </MenuItem>
        <div className="my-1 border-t border-white/5" />
        <MenuItem
          icon={
            inWatchlist ? (
              <BookmarkCheck className="size-3.5" fill="currentColor" />
            ) : (
              <Bookmark className="size-3.5" />
            )
          }
          onClick={() => {
            onToggleWatchlist();
            onClose();
          }}
          tone={inWatchlist ? "amber" : undefined}
        >
          {inWatchlist ? "Remove from watchlist" : "Add to watchlist"}
        </MenuItem>
        <MenuItem
          icon={<CheckCircle2 className="size-3.5" />}
          onClick={() => {
            onMarkCompleted();
            onClose();
          }}
        >
          Mark as watched
        </MenuItem>
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  onClick,
  tone,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  tone?: "amber";
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/10",
        tone === "amber" ? "text-amber-200" : "text-white/85",
      )}
    >
      <span className="text-white/60">{icon}</span>
      {children}
    </button>
  );
}
