import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { api } from "@/api";
import { useAppStore } from "@/store";
import { ChannelCard } from "@/components/channel-card";
import { cn } from "@/lib/utils";

const QUALITY_BUCKETS: Array<{ id: string; label: string; match: (q: string | null) => boolean }> = [
  { id: "1080p", label: "1080p", match: (q) => !!q && /1080|fhd/i.test(q) },
  { id: "720p", label: "720p", match: (q) => !!q && /720|hd/i.test(q) },
  { id: "480p", label: "480p", match: (q) => !!q && /480/i.test(q) },
  { id: "sd", label: "Standard", match: (q) => !q || /240|360|sd|auto/i.test(q) },
];

export function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const categoryParam = params.get("category");
  const countryParam = params.get("country");
  const qualityParam = params.get("quality");
  const [search, setSearch] = useState(params.get("q") ?? "");
  const setCurrent = useAppStore((s) => s.setCurrent);
  const current = useAppStore((s) => s.current);
  const qc = useQueryClient();

  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (search) next.set("q", search);
      else next.delete("q");
      setParams(next, { replace: true });
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: api.categories,
  });
  const { data: countries = [] } = useQuery({
    queryKey: ["countries"],
    queryFn: api.countries,
  });
  const [showAllCountries, setShowAllCountries] = useState(false);

  const { data: channels = [], isFetching } = useQuery({
    queryKey: ["channels", search, categoryParam, countryParam],
    queryFn: () =>
      api.listChannels({
        search: search || undefined,
        category: categoryParam || undefined,
        country: countryParam || undefined,
        limit: 1500,
      }),
  });

  const filtered = useMemo(() => {
    if (!qualityParam) return channels;
    const bucket = QUALITY_BUCKETS.find((b) => b.id === qualityParam);
    if (!bucket) return channels;
    return channels.filter((c) => bucket.match(c.quality));
  }, [channels, qualityParam]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const c of filtered) {
      const display = c.name ?? c.channel;
      const first = display[0]?.toUpperCase() ?? "#";
      const k = /[A-Z]/.test(first) ? first : "#";
      const arr = map.get(k);
      if (arr) arr.push(c);
      else map.set(k, [c]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const setFav = useMutation({
    mutationFn: ({ channel, fav }: { channel: string; fav: boolean }) =>
      api.setFavorite(channel, fav),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["favorites"] });
    },
  });

  const updateParam = (key: string, value: string | null) => {
    const n = new URLSearchParams(params);
    if (value === null || n.get(key) === value) n.delete(key);
    else n.set(key, value);
    setParams(n);
  };

  const activeChips: Array<[string, string]> = [];
  if (categoryParam) activeChips.push(["category", categoryParam]);
  if (countryParam) activeChips.push(["country", countryParam]);
  if (qualityParam) activeChips.push(["quality", qualityParam]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl">
      <div className="space-y-3 border-b border-white/5 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search channels…"
            className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/40 focus:border-cyan-300/50 focus:outline-none"
          />
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-white/50">Category</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {categories.slice(0, 14).map((c) => (
              <Chip
                key={c.value}
                active={categoryParam === c.value}
                onClick={() => updateParam("category", c.value)}
                count={c.count}
              >
                <span className="capitalize">{c.value}</span>
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-white/50">
            <span>Country</span>
            {countries.length > 14 && (
              <button
                onClick={() => setShowAllCountries((v) => !v)}
                className="text-cyan-300 hover:text-cyan-100"
              >
                {showAllCountries
                  ? "Show fewer"
                  : `Show all (${countries.length})`}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(showAllCountries ? countries : countries.slice(0, 14)).map(
              (c) => (
                <Chip
                  key={c.value}
                  active={countryParam === c.value}
                  onClick={() => updateParam("country", c.value)}
                  count={c.count}
                >
                  <span className="uppercase">{c.value}</span>
                </Chip>
              ),
            )}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-white/50">Quality</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {QUALITY_BUCKETS.map((b) => (
              <Chip
                key={b.id}
                active={qualityParam === b.id}
                onClick={() => updateParam("quality", b.id)}
              >
                {b.label}
              </Chip>
            ))}
          </div>
        </div>

        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-2">
            <span className="text-xs text-white/50">Filters</span>
            {activeChips.map(([k, v]) => (
              <button
                key={k}
                onClick={() => updateParam(k, null)}
                className="inline-flex items-center gap-1 rounded-full bg-cyan-300/15 px-2.5 py-1 text-xs font-medium capitalize text-cyan-100 hover:bg-cyan-300/25"
              >
                {v}
                <X className="size-3" />
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-white/50">
          <span>{filtered.length} channels</span>
          {isFetching && <span>Loading…</span>}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
        {grouped.map(([letter, rows]) => (
          <section key={letter} className="mb-2">
            <h3 className="sticky top-0 z-10 mb-1 bg-neutral-950/60 px-2 py-1 text-xs font-semibold text-white/50 backdrop-blur">
              {letter}
            </h3>
            <div className="flex flex-col gap-0.5">
              {rows.map((c) => (
                <ChannelCard
                  key={`${c.channel}-${c.url}`}
                  channel={c}
                  active={current?.url === c.url}
                  onClick={() => setCurrent(c)}
                  onToggleFavorite={() =>
                    setFav.mutate({ channel: c.channel, fav: !c.favorite })
                  }
                />
              ))}
            </div>
          </section>
        ))}
        {grouped.length === 0 && !isFetching && (
          <div className="m-2 rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-white/50">
            No channels match those filters. Try clearing one.
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  count,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100"
          : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10",
      )}
    >
      <span>{children}</span>
      {count !== undefined && (
        <span className="text-[10px] text-white/40">{count}</span>
      )}
    </button>
  );
}
