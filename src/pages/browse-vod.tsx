import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronDown,
  ChevronLeft,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { api } from "@/api";
import { PosterTile } from "@/components/poster-row";
import type { DiscoverQuery, PosterCard } from "@/types";
import { cn } from "@/lib/utils";

type Kind = "movie" | "tv";

type Filters = {
  genreId: number | null;
  yearFrom: number | null;
  yearTo: number | null;
  language: string | null;
  region: string | null;
  minRating: number;
  minVotes: number;
  runtimeMin: number | null;
  runtimeMax: number | null;
  sort: string;
};

const CURRENT_YEAR = new Date().getFullYear();

const DEFAULT_FILTERS: Filters = {
  genreId: null,
  yearFrom: null,
  yearTo: null,
  language: null,
  region: null,
  minRating: 0,
  minVotes: 0,
  runtimeMin: null,
  runtimeMax: null,
  sort: "popularity.desc",
};

const SORTS_MOVIE = [
  { value: "popularity.desc", label: "Most popular" },
  { value: "vote_average.desc", label: "Top rated" },
  { value: "vote_count.desc", label: "Most voted" },
  { value: "primary_release_date.desc", label: "Newest" },
  { value: "primary_release_date.asc", label: "Oldest" },
  { value: "revenue.desc", label: "Highest box office" },
  { value: "title.asc", label: "Title A→Z" },
  { value: "title.desc", label: "Title Z→A" },
];

const SORTS_TV = [
  { value: "popularity.desc", label: "Most popular" },
  { value: "vote_average.desc", label: "Top rated" },
  { value: "vote_count.desc", label: "Most voted" },
  { value: "first_air_date.desc", label: "Newest" },
  { value: "first_air_date.asc", label: "Oldest" },
  { value: "name.asc", label: "Title A→Z" },
  { value: "name.desc", label: "Title Z→A" },
];

const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "hi", label: "Hindi" },
  { value: "pt", label: "Portuguese" },
  { value: "ru", label: "Russian" },
  { value: "ar", label: "Arabic" },
  { value: "tr", label: "Turkish" },
  { value: "sv", label: "Swedish" },
  { value: "nl", label: "Dutch" },
  { value: "pl", label: "Polish" },
];

const REGIONS: Array<{ value: string; label: string }> = [
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "CA", label: "Canada" },
  { value: "AU", label: "Australia" },
  { value: "FR", label: "France" },
  { value: "DE", label: "Germany" },
  { value: "ES", label: "Spain" },
  { value: "IT", label: "Italy" },
  { value: "JP", label: "Japan" },
  { value: "KR", label: "Korea" },
  { value: "IN", label: "India" },
  { value: "BR", label: "Brazil" },
  { value: "MX", label: "Mexico" },
  { value: "ZA", label: "South Africa" },
  { value: "NG", label: "Nigeria" },
  { value: "ZW", label: "Zimbabwe" },
];

function isFilterActive(f: Filters): boolean {
  return (
    f.genreId !== null ||
    f.yearFrom !== null ||
    f.yearTo !== null ||
    f.language !== null ||
    f.region !== null ||
    f.minRating > 0 ||
    f.minVotes > 0 ||
    f.runtimeMin !== null ||
    f.runtimeMax !== null ||
    f.sort !== "popularity.desc"
  );
}

function filtersToQuery(kind: Kind, f: Filters, page: number): DiscoverQuery {
  return {
    kind,
    genre_id: f.genreId,
    year_from: f.yearFrom,
    year_to: f.yearTo,
    sort: f.sort,
    page,
    language: f.language,
    region: f.region,
    min_rating: f.minRating > 0 ? f.minRating : null,
    min_votes: f.minVotes > 0 ? f.minVotes : null,
    runtime_min: f.runtimeMin,
    runtime_max: f.runtimeMax,
  };
}

export function BrowseVodPage() {
  const params = useParams();
  const navigate = useNavigate();
  const kind: Kind = params.kind === "tv" ? "tv" : "movie";

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(true);

  const genres = useQuery({
    queryKey: ["vod", "genres", kind],
    queryFn: () => api.vodGenres(kind),
  });

  const sortOptions = kind === "tv" ? SORTS_TV : SORTS_MOVIE;

  const discover = useInfiniteQuery({
    queryKey: ["vod", "browse", kind, filters],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.vodDiscover(filtersToQuery(kind, filters, pageParam)),
    getNextPageParam: (lastPage, allPages) => {
      // TMDB returns up to 20 per page, capped at page 500. Stop when a page
      // is empty or short — that's the end of meaningful results.
      if (!lastPage || lastPage.length < 20) return undefined;
      const next = allPages.length + 1;
      if (next > 500) return undefined;
      return next;
    },
  });

  const items: PosterCard[] = useMemo(() => {
    const seen = new Set<string>();
    const out: PosterCard[] = [];
    for (const page of discover.data?.pages ?? []) {
      for (const item of page) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
      }
    }
    return out;
  }, [discover.data]);

  // Infinite scroll sentinel — load next page as user nears the bottom of
  // the grid. We use IntersectionObserver to keep this independent of the
  // outer scroll container.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (discover.hasNextPage && !discover.isFetchingNextPage) {
          discover.fetchNextPage();
        }
      },
      { rootMargin: "600px 0px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [discover.hasNextPage, discover.isFetchingNextPage, discover.fetchNextPage]);

  const titleLabel = kind === "tv" ? "Browse all series" : "Browse all movies";

  return (
    <div className="@container flex h-full flex-col overflow-hidden">
      <header className="space-y-3 border-b border-white/5 px-6 py-5">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
        >
          <ChevronLeft className="size-3.5" />
          Back
        </button>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold @lg:text-3xl">{titleLabel}</h1>
            <p className="text-sm text-white/60">
              {items.length > 0
                ? `${items.length.toLocaleString()} title${items.length === 1 ? "" : "s"} loaded`
                : "Pick filters to start browsing"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowFilters((s) => !s)}
              className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
            >
              <SlidersHorizontal className="size-3.5" />
              {showFilters ? "Hide filters" : "Show filters"}
            </button>
            {isFilterActive(filters) && (
              <button
                onClick={() => setFilters(DEFAULT_FILTERS)}
                className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
              >
                <RotateCcw className="size-3.5" />
                Reset
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {showFilters && (
          <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-white/5 bg-black/20 px-5 py-5 @md:block">
            <FilterPanel
              kind={kind}
              filters={filters}
              setFilters={setFilters}
              genres={genres.data ?? []}
              sortOptions={sortOptions}
            />
          </aside>
        )}

        <main className="flex-1 overflow-y-auto px-6 py-5">
          {discover.isLoading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-white/50">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : discover.error ? (
            <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200">
              Couldn't load: {String(discover.error)}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-10 text-center text-sm text-white/50">
              No matches for these filters. Try widening them.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @xl:grid-cols-4 @3xl:grid-cols-5 @5xl:grid-cols-6">
                {items.map((item) => (
                  <PosterTile key={item.id} item={item} size="fill" />
                ))}
              </div>

              <div ref={sentinelRef} className="h-12" />

              {discover.isFetchingNextPage && (
                <div className="flex items-center justify-center gap-2 py-4 text-sm text-white/50">
                  <Loader2 className="size-4 animate-spin" />
                  Loading more…
                </div>
              )}

              {!discover.hasNextPage && items.length >= 20 && (
                <div className="py-6 text-center text-xs text-white/40">
                  End of results.
                </div>
              )}
            </>
          )}

          {showFilters && (
            <div className="mt-6 @md:hidden">
              <details className="rounded-xl border border-white/10 bg-white/5 p-4">
                <summary className="cursor-pointer text-sm font-medium text-white/80">
                  Filters
                </summary>
                <div className="mt-3">
                  <FilterPanel
                    kind={kind}
                    filters={filters}
                    setFilters={setFilters}
                    genres={genres.data ?? []}
                    sortOptions={sortOptions}
                  />
                </div>
              </details>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function FilterPanel({
  kind: _kind,
  filters,
  setFilters,
  genres,
  sortOptions,
}: {
  kind: Kind;
  filters: Filters;
  setFilters: (f: Filters) => void;
  genres: Array<{ id: number; name: string }>;
  sortOptions: Array<{ value: string; label: string }>;
}) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setFilters({ ...filters, [k]: v });

  type Option = { value: string; label: string };
  const yearOptions: Option[] = [];
  for (let y = CURRENT_YEAR + 1; y >= 1900; y--) {
    yearOptions.push({ value: String(y), label: String(y) });
  }

  return (
    <div className="space-y-5 text-sm">
      <Section title="Sort by">
        <SelectField
          value={filters.sort}
          onChange={(v) => set("sort", v)}
          options={sortOptions}
        />
      </Section>

      <Section title="Genre">
        <SelectField
          value={filters.genreId !== null ? String(filters.genreId) : ""}
          onChange={(v) => set("genreId", v ? Number(v) : null)}
          placeholder="Any genre"
          options={genres.map((g) => ({ value: String(g.id), label: g.name }))}
        />
      </Section>

      <Section title="Year range">
        <div className="grid grid-cols-2 gap-2">
          <SelectField
            value={filters.yearFrom !== null ? String(filters.yearFrom) : ""}
            onChange={(v) => set("yearFrom", v ? Number(v) : null)}
            placeholder="From"
            options={yearOptions}
          />
          <SelectField
            value={filters.yearTo !== null ? String(filters.yearTo) : ""}
            onChange={(v) => set("yearTo", v ? Number(v) : null)}
            placeholder="To"
            options={yearOptions}
          />
        </div>
      </Section>

      <Section title="Original language">
        <SelectField
          value={filters.language ?? ""}
          onChange={(v) => set("language", v || null)}
          placeholder="Any language"
          options={LANGUAGES}
        />
      </Section>

      <Section title="Region">
        <SelectField
          value={filters.region ?? ""}
          onChange={(v) => set("region", v || null)}
          placeholder="Any region"
          options={REGIONS}
        />
      </Section>

      <Section
        title={`Minimum rating: ${filters.minRating > 0 ? filters.minRating.toFixed(1) : "any"}`}
      >
        <input
          type="range"
          min={0}
          max={9}
          step={0.5}
          value={filters.minRating}
          onChange={(e) => set("minRating", Number(e.target.value))}
          className="h-1 w-full cursor-pointer accent-cyan-300"
        />
      </Section>

      <Section
        title={`Minimum votes: ${filters.minVotes > 0 ? filters.minVotes.toLocaleString() : "any"}`}
      >
        <input
          type="range"
          min={0}
          max={5000}
          step={50}
          value={filters.minVotes}
          onChange={(e) => set("minVotes", Number(e.target.value))}
          className="h-1 w-full cursor-pointer accent-cyan-300"
        />
        <p className="mt-1 text-[11px] text-white/40">
          Higher = filters out obscure titles with few ratings.
        </p>
      </Section>

      <Section title="Runtime (minutes)">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            placeholder="Min"
            value={filters.runtimeMin}
            onChange={(v) => set("runtimeMin", v)}
          />
          <NumberField
            placeholder="Max"
            value={filters.runtimeMax}
            onChange={(v) => set("runtimeMax", v)}
          />
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
        {title}
      </div>
      {children}
    </div>
  );
}

// Shared field styling so every dropdown / numeric input on this page has
// the exact same height, border, padding, hover/focus state, and chevron
// (for selects). Native <select> chevrons render differently across
// platforms — drawing our own with ChevronDown keeps them uniform.
const FIELD_BASE =
  "h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/40 transition-colors outline-none focus:border-cyan-300/40 hover:border-white/20";

function SelectField({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(FIELD_BASE, "appearance-none pr-9", !value && "text-white/55")}
      >
        {placeholder !== undefined && (
          <option value="" className="bg-neutral-900 text-white/60">
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-neutral-900 text-white">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-white/45" />
    </div>
  );
}

function NumberField({
  value,
  onChange,
  placeholder,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      min={0}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className={FIELD_BASE}
    />
  );
}
