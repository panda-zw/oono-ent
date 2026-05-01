import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Star, ChevronLeft, Clock, Bookmark, BookmarkCheck } from "lucide-react";
import { api } from "@/api";
import { tmdbImage } from "@/lib/tmdb";
import { cn } from "@/lib/utils";

export function VodDetailPage({ kind }: { kind: "movie" | "tv" }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const tmdbId = Number(id);
  const [season, setSeason] = useState<number>(1);

  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["vod", "detail", kind, tmdbId],
    queryFn: () => api.vodDetail(kind, tmdbId),
    enabled: Number.isFinite(tmdbId),
  });
  const mediaId = `${kind}:${tmdbId}`;
  const inWatchlist = useQuery({
    queryKey: ["watchlist", "has", mediaId],
    queryFn: () => api.vodWatchlistHas(mediaId),
    enabled: !!detail.data,
  });
  const toggleWatchlist = useMutation({
    mutationFn: async () => {
      if (inWatchlist.data) await api.vodWatchlistRemove(mediaId);
      else await api.vodWatchlistAdd(mediaId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watchlist"] });
      qc.invalidateQueries({ queryKey: ["watchlist", "has", mediaId] });
    },
  });

  useEffect(() => {
    if (detail.data?.kind === "tv" && detail.data.seasons.length > 0) {
      setSeason(detail.data.seasons[0].season_number);
    }
  }, [detail.data]);

  const episodes = useQuery({
    queryKey: ["vod", "episodes", tmdbId, season],
    queryFn: () => api.vodEpisodes(tmdbId, season),
    enabled: detail.data?.kind === "tv",
  });

  const d = detail.data;
  if (!d && detail.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-white/60">
        Loading…
      </div>
    );
  }
  if (!d) return null;

  const backdrop = tmdbImage(d.backdrop_path, "w780");
  const poster = tmdbImage(d.poster_path, "w342");

  return (
    <div className="@container flex h-full flex-col overflow-y-auto">
      <div className="relative h-80 shrink-0 overflow-hidden @lg:h-96">
        {backdrop && (
          <img
            src={backdrop}
            alt=""
            className="h-full w-full object-cover mask-[linear-gradient(to_bottom,black_0%,black_55%,transparent_100%)]"
          />
        )}
        <button
          onClick={() => navigate(-1)}
          className="absolute left-4 top-4 inline-flex items-center gap-1 rounded-full bg-black/40 px-3 py-1.5 text-xs text-white/80 backdrop-blur hover:bg-black/60"
        >
          <ChevronLeft className="size-3.5" />
          Back
        </button>
      </div>

      <div className="-mt-32 flex flex-col gap-6 px-6 pb-6 @lg:flex-row">
        {poster && (
          <img
            src={poster}
            alt={d.title}
            className="z-10 h-72 w-48 shrink-0 rounded-xl border border-white/10 object-cover shadow-2xl"
          />
        )}
        <div className="z-10 flex-1 space-y-3">
          <div>
            <h1 className="text-3xl font-semibold">{d.title}</h1>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-white/60">
              {d.release_date && (
                <span>{d.release_date.slice(0, 4)}</span>
              )}
              {d.vote_average !== null && d.vote_average > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Star className="size-3.5 fill-amber-300 text-amber-300" />
                  {d.vote_average.toFixed(1)}
                </span>
              )}
              {d.runtime && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" />
                  {d.runtime}m
                </span>
              )}
              {d.genres.length > 0 && <span>{d.genres.join(" · ")}</span>}
            </div>
          </div>
          {d.tagline && (
            <p className="italic text-sm text-white/60">"{d.tagline}"</p>
          )}
          {d.overview && <p className="text-sm text-white/80">{d.overview}</p>}
          {d.crew.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
              {d.crew.slice(0, 6).map((c, i) => (
                <span key={`${c.name}-${i}`}>
                  <span className="text-white/40">{c.job}:</span>{" "}
                  <span className="text-white/85">{c.name}</span>
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {d.kind === "movie" && (
              <button
                onClick={() => navigate(`/watch/movie/${tmdbId}`)}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-300/20 px-5 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/30"
              >
                <Play className="size-4" fill="currentColor" />
                Watch now
              </button>
            )}
            {d.kind === "tv" && d.seasons.length > 0 && (
              <button
                onClick={() => {
                  // Default to the first non-special season (season > 0).
                  // This jumps straight into S1E1; users can pick a
                  // different episode via the season list below.
                  const firstSeason =
                    d.seasons.find((s) => s.season_number > 0) ??
                    d.seasons[0];
                  navigate(
                    `/watch/tv/${tmdbId}?s=${firstSeason.season_number}&e=1`,
                  );
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-300/20 px-5 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/30"
              >
                <Play className="size-4" fill="currentColor" />
                Watch series
              </button>
            )}
            <button
              onClick={() => toggleWatchlist.mutate()}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
                inWatchlist.data
                  ? "bg-amber-300/20 text-amber-200 hover:bg-amber-300/30"
                  : "bg-white/5 text-white/80 hover:bg-white/15",
              )}
            >
              {inWatchlist.data ? (
                <>
                  <BookmarkCheck className="size-4" fill="currentColor" />
                  In watchlist
                </>
              ) : (
                <>
                  <Bookmark className="size-4" />
                  Add to watchlist
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {d.cast.length > 0 && (
        <section className="space-y-3 px-6 pb-2">
          <h3 className="text-base font-semibold text-white">Cast</h3>
          <div className="-mx-2 flex gap-3 overflow-x-auto px-2 pb-2">
            {d.cast.slice(0, 16).map((c) => {
              const url = tmdbImage(c.profile_path, "w185");
              return (
                <button
                  key={`${c.tmdb_id}-${c.character ?? ""}`}
                  onClick={() => navigate(`/people/${c.tmdb_id}`)}
                  className="group w-28 shrink-0 text-left"
                >
                  <div className="aspect-2/3 overflow-hidden rounded-lg border border-white/10 bg-white/5 transition-transform duration-200 group-hover:scale-[1.03]">
                    {url ? (
                      <img
                        src={url}
                        alt={c.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="mt-1 truncate text-xs font-medium text-white group-hover:text-cyan-200">
                    {c.name}
                  </div>
                  {c.character && (
                    <div className="truncate text-[11px] text-white/50">
                      {c.character}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {d.production_companies.length > 0 && (
        <section className="space-y-2 px-6 pb-6">
          <h3 className="text-base font-semibold text-white">Production</h3>
          <div className="flex flex-wrap items-center gap-3">
            {d.production_companies.map((p) => {
              const url = tmdbImage(p.logo_path, "w185");
              return (
                <div
                  key={p.name}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5"
                >
                  {url ? (
                    <img
                      src={url}
                      alt={p.name}
                      className="h-5 max-w-20 object-contain"
                    />
                  ) : null}
                  <span className="text-xs text-white/80">{p.name}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {d.kind === "tv" && (
        <div className="space-y-3 px-6 pb-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-white/70">Season:</span>
            {d.seasons.map((s) => (
              <button
                key={s.season_number}
                onClick={() => setSeason(s.season_number)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  s.season_number === season
                    ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100"
                    : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10",
                )}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="grid gap-2 @md:grid-cols-2 @2xl:grid-cols-3">
            {episodes.data?.map((ep) => {
              const still = tmdbImage(ep.still_path, "w342");
              return (
                <button
                  key={`${ep.season_number}-${ep.episode_number}`}
                  onClick={() =>
                    navigate(
                      `/watch/tv/${tmdbId}?s=${ep.season_number}&e=${ep.episode_number}`,
                    )
                  }
                  className="group flex gap-3 rounded-xl border border-white/10 bg-white/5 p-2 text-left hover:border-white/20 hover:bg-white/10"
                >
                  <div className="aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-white/5">
                    {still ? (
                      <img
                        src={still}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-white/50">
                      Ep {ep.episode_number}
                    </div>
                    <div className="truncate text-sm font-medium text-white">
                      {ep.name}
                    </div>
                    {ep.overview && (
                      <p className="line-clamp-2 text-xs text-white/60">
                        {ep.overview}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
            {episodes.isLoading && (
              <div className="text-sm text-white/50">Loading episodes…</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
