import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  Clock,
  Loader2,
  Radio,
  Search,
  X,
} from "lucide-react";
import { api } from "@/api";
import type { SportEvent } from "@/types";
import { cn } from "@/lib/utils";

type Props = {
  enabled: boolean;
  onPickEvent: (event: SportEvent) => void;
};

const SPORT_ORDER = [
  "soccer",
  "basketball",
  "americanfootball",
  "icehockey",
  "baseball",
  "motorsport",
  "rugby",
  "cricket",
  "tennis",
  "fighting",
];

const SPORT_LABEL_OVERRIDE: Record<string, string> = {
  soccer: "Football",
  americanfootball: "NFL",
  icehockey: "Hockey",
  motorsport: "Motorsport",
};

function dayOffset(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function formatTime(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SportsSchedule({ enabled, onPickEvent }: Props) {
  const [date, setDate] = useState(() => dayOffset(0));
  const [sport, setSport] = useState<string>("all");
  const [liveOnly, setLiveOnly] = useState(false);
  const [search, setSearch] = useState("");

  const schedule = useQuery({
    queryKey: ["acestream", "schedule", date],
    queryFn: () => api.acestreamSchedule(date),
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const events = schedule.data ?? [];

  const sports = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const e of events) {
      const cur = counts.get(e.sport);
      if (cur) cur.count += 1;
      else
        counts.set(e.sport, {
          label: SPORT_LABEL_OVERRIDE[e.sport] ?? e.sport_label,
          count: 1,
        });
    }
    return SPORT_ORDER.filter((s) => counts.has(s)).map((s) => ({
      key: s,
      label: counts.get(s)!.label,
      count: counts.get(s)!.count,
    }));
  }, [events]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (sport !== "all" && e.sport !== sport) return false;
      if (liveOnly && !e.is_live) return false;
      if (q) {
        const hay = `${e.title} ${e.home ?? ""} ${e.away ?? ""} ${e.league ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, sport, liveOnly, search]);

  const liveCount = events.filter((e) => e.is_live).length;

  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">What's on today</h2>
          <p className="text-xs text-white/50">
            Pick a match — we'll prefill its title so your stream ID gets saved
            with the right name.
          </p>
        </div>
        {liveCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-400/15 px-2.5 py-0.5 text-xs font-medium text-red-200">
            <span className="size-1.5 animate-pulse rounded-full bg-red-400" />
            {liveCount} live
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 text-xs">
          <button
            onClick={() => setDate(dayOffset(-1))}
            className={cn(
              "rounded-full px-3 py-1 transition-colors",
              date === dayOffset(-1)
                ? "bg-white/15 text-white"
                : "text-white/60 hover:text-white",
            )}
          >
            Yesterday
          </button>
          <button
            onClick={() => setDate(dayOffset(0))}
            className={cn(
              "rounded-full px-3 py-1 transition-colors",
              date === dayOffset(0)
                ? "bg-white/15 text-white"
                : "text-white/60 hover:text-white",
            )}
          >
            Today
          </button>
          <button
            onClick={() => setDate(dayOffset(1))}
            className={cn(
              "rounded-full px-3 py-1 transition-colors",
              date === dayOffset(1)
                ? "bg-white/15 text-white"
                : "text-white/60 hover:text-white",
            )}
          >
            Tomorrow
          </button>
          <button
            onClick={() => setDate(dayOffset(2))}
            className={cn(
              "rounded-full px-3 py-1 transition-colors",
              date === dayOffset(2)
                ? "bg-white/15 text-white"
                : "text-white/60 hover:text-white",
            )}
          >
            +2 days
          </button>
        </div>
        <button
          onClick={() => setLiveOnly((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
            liveOnly
              ? "border-red-400/40 bg-red-400/15 text-red-100"
              : "border-white/10 bg-white/5 text-white/60 hover:text-white",
          )}
        >
          <Radio className="size-3" />
          Live now
        </button>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Team or league…"
            className="h-7 w-44 rounded-full border border-white/10 bg-white/5 pl-8 pr-7 text-xs text-white placeholder:text-white/40 focus:border-cyan-300/40 focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {sports.length > 1 && (
        <div className="-mx-1 flex flex-wrap gap-1">
          <button
            onClick={() => setSport("all")}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition-colors",
              sport === "all"
                ? "bg-cyan-300/20 text-cyan-100"
                : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white",
            )}
          >
            All sports
            <span className="ml-1.5 text-[10px] text-white/40">
              {events.length}
            </span>
          </button>
          {sports.map((s) => (
            <button
              key={s.key}
              onClick={() => setSport(s.key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs transition-colors",
                sport === s.key
                  ? "bg-cyan-300/20 text-cyan-100"
                  : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white",
              )}
            >
              {s.label}
              <span className="ml-1.5 text-[10px] text-white/40">
                {s.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {schedule.isLoading && (
        <div className="flex items-center gap-2 py-6 text-sm text-white/50">
          <Loader2 className="size-4 animate-spin" />
          Loading today's matches…
        </div>
      )}

      {schedule.error && (
        <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-200">
          Couldn't load schedule: {String(schedule.error)}
        </div>
      )}

      {!schedule.isLoading && filtered.length === 0 && events.length > 0 && (
        <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-white/50">
          No matches match those filters.
        </div>
      )}

      {!schedule.isLoading && events.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-white/50">
          <CalendarDays className="mx-auto mb-2 size-5 text-white/40" />
          No matches scheduled for this day.
        </div>
      )}

      {filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-2 @md:grid-cols-2 @xl:grid-cols-3">
          {filtered.slice(0, 60).map((e) => (
            <EventCard key={e.id} event={e} onPick={() => onPickEvent(e)} />
          ))}
        </div>
      )}

      {filtered.length > 60 && (
        <div className="text-center text-xs text-white/40">
          Showing first 60 of {filtered.length} — narrow with search or filters.
        </div>
      )}
    </section>
  );
}

function EventCard({
  event,
  onPick,
}: {
  event: SportEvent;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      className={cn(
        "group flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors",
        event.is_live
          ? "border-red-400/30 bg-red-400/5 hover:border-red-400/50 hover:bg-red-400/10"
          : "border-white/10 bg-white/[0.03] hover:border-cyan-300/30 hover:bg-white/[0.06]",
      )}
    >
      <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-white/40">
        <div className="flex min-w-0 items-center gap-1.5">
          {event.league_badge && (
            <img
              src={event.league_badge}
              alt=""
              className="size-3 shrink-0 rounded-sm object-contain"
              loading="lazy"
            />
          )}
          <span className="truncate">{event.league ?? event.sport_label}</span>
        </div>
        {event.is_live ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-400/20 px-1.5 py-0.5 text-[9px] font-semibold text-red-200">
            <span className="size-1 animate-pulse rounded-full bg-red-400" />
            LIVE
          </span>
        ) : event.timestamp ? (
          <span className="inline-flex items-center gap-1 text-white/50">
            <Clock className="size-2.5" />
            {formatTime(event.timestamp)}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {event.home && event.away ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {event.home_badge && (
              <img
                src={event.home_badge}
                alt=""
                className="size-6 shrink-0 rounded-sm object-contain"
                loading="lazy"
              />
            )}
            <span className="truncate text-sm font-medium text-white">
              {event.home}
            </span>
            <span className="text-xs text-white/40">vs</span>
            <span className="truncate text-sm font-medium text-white">
              {event.away}
            </span>
            {event.away_badge && (
              <img
                src={event.away_badge}
                alt=""
                className="size-6 shrink-0 rounded-sm object-contain"
                loading="lazy"
              />
            )}
          </div>
        ) : (
          <span className="truncate text-sm font-medium text-white">
            {event.title}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-white/40">
          {SPORT_LABEL_OVERRIDE[event.sport] ?? event.sport_label}
          {event.country ? ` · ${event.country}` : ""}
        </span>
        <span className="rounded-full bg-cyan-300/10 px-2 py-0.5 text-[10px] font-medium text-cyan-200 opacity-0 transition-opacity group-hover:opacity-100">
          Add stream →
        </span>
      </div>
    </button>
  );
}
