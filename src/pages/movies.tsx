import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "@/api";
import { PosterRow, PosterTile } from "@/components/poster-row";
import { PersonRow } from "@/components/person-tile";
import { TmdbKeyEmpty } from "@/components/tmdb-key-empty";
import {
  DiscoverFilters,
  DISCOVER_DEFAULT,
  type DiscoverState,
} from "@/components/discover-filters";

export function MoviesPage() {
  const hasKey = useQuery({
    queryKey: ["vod", "hasKey"],
    queryFn: api.vodHasApiKey,
  });

  if (hasKey.data === false) return <TmdbKeyEmpty />;
  return <MoviesPageInner />;
}

function MoviesPageInner() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<DiscoverState>(DISCOVER_DEFAULT);
  const filtersActive = useMemo(
    () =>
      filters.genreId !== null ||
      filters.year !== null ||
      filters.sort !== DISCOVER_DEFAULT.sort,
    [filters],
  );
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const trending = useQuery({
    queryKey: ["vod", "trending"],
    queryFn: () => api.vodBrowse("trending"),
  });
  const popular = useQuery({
    queryKey: ["vod", "popular_movies"],
    queryFn: () => api.vodBrowse("popular_movies"),
  });
  const topRated = useQuery({
    queryKey: ["vod", "top_rated_movies"],
    queryFn: () => api.vodBrowse("top_rated_movies"),
  });
  const nowPlaying = useQuery({
    queryKey: ["vod", "now_playing_movies"],
    queryFn: () => api.vodBrowse("now_playing_movies"),
  });

  const searchResults = useQuery({
    queryKey: ["vod", "search", debounced],
    queryFn: () => api.vodSearch(debounced),
    enabled: debounced.trim().length > 1,
  });

  const discover = useQuery({
    queryKey: [
      "vod",
      "discover",
      "movie",
      filters.genreId,
      filters.year,
      filters.sort,
    ],
    queryFn: () =>
      api.vodDiscover({
        kind: "movie",
        genre_id: filters.genreId,
        year: filters.year,
        sort: filters.sort,
        page: 1,
      }),
    enabled: filtersActive && debounced.trim().length <= 1,
  });

  return (
    <div className="@container flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold @lg:text-3xl">Movies</h1>
          <p className="text-sm text-white/60">
            Browse and search films from around the world
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/browse/movie")}
            className="hidden whitespace-nowrap rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/10 @md:inline-flex"
          >
            Browse all →
          </button>
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search movies and shows…"
              className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/40 focus:border-cyan-300/50 focus:outline-none"
            />
          </div>
        </div>
      </header>

      <DiscoverFilters
        kind="movie"
        state={filters}
        onChange={setFilters}
      />

      {debounced.trim().length > 1 ? (
        <section className="space-y-5">
          <h3 className="text-base font-semibold">
            Results for "{debounced}"
          </h3>
          <PersonRow
            title="People"
            people={searchResults.data?.people ?? []}
          />
          <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @xl:grid-cols-4 @3xl:grid-cols-5">
            {searchResults.data?.titles.map((item) => (
              <PosterTile key={item.id} item={item} size="fill" />
            ))}
          </div>
          {searchResults.isLoading && (
            <div className="text-sm text-white/50">Searching…</div>
          )}
        </section>
      ) : filtersActive ? (
        <section className="space-y-3">
          <h3 className="text-base font-semibold">Filtered</h3>
          <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @xl:grid-cols-4 @3xl:grid-cols-5">
            {discover.data?.map((item) => (
              <PosterTile key={item.id} item={item} size="fill" />
            ))}
          </div>
          {discover.isLoading && (
            <div className="text-sm text-white/50">Loading…</div>
          )}
          {discover.data && discover.data.length === 0 && !discover.isLoading && (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-white/50">
              No matches. Try a different combination.
            </div>
          )}
        </section>
      ) : (
        <>
          <PosterRow
            title="Trending this week"
            items={trending.data?.filter((i) => i.kind === "movie")}
            loading={trending.isLoading}
          />
          <PosterRow
            title="In theaters"
            items={nowPlaying.data}
            loading={nowPlaying.isLoading}
          />
          <PosterRow
            title="Popular"
            items={popular.data}
            loading={popular.isLoading}
          />
          <PosterRow
            title="Top rated"
            items={topRated.data}
            loading={topRated.isLoading}
          />
        </>
      )}
    </div>
  );
}
