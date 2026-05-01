import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Bookmark, Play, X } from "lucide-react";
import { api } from "@/api";
import { tmdbImage } from "@/lib/tmdb";

export function WatchlistPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["watchlist"],
    queryFn: api.vodWatchlistList,
  });

  const remove = useMutation({
    mutationFn: (mediaId: string) => api.vodWatchlistRemove(mediaId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  return (
    <div className="@container flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold @lg:text-3xl">Watchlist</h1>
        <p className="text-sm text-white/60">
          Movies and shows you've saved for later
        </p>
      </header>

      {list.data?.length === 0 && !list.isLoading && (
        <div className="glass mx-auto max-w-md rounded-2xl p-8 text-center">
          <Bookmark className="mx-auto mb-2 size-6 text-white/40" />
          <p className="text-sm text-white/70">Your watchlist is empty.</p>
          <p className="mt-1 text-xs text-white/50">
            Tap the bookmark on any movie or series to save it here.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @xl:grid-cols-4 @3xl:grid-cols-5">
        {list.data?.map((item) => {
          const poster = tmdbImage(item.poster_path, "w342");
          return (
            <div key={item.id} className="group relative">
              <button
                onClick={() =>
                  navigate(
                    `/${item.kind === "tv" ? "series" : "movies"}/${item.tmdb_id}`,
                  )
                }
                className="block w-full text-left"
              >
                <div className="relative h-56 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                  {poster ? (
                    <img
                      src={poster}
                      alt={item.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : null}
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-linear-to-t from-black/80 to-transparent p-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(
                          `/watch/${item.kind}/${item.tmdb_id}${
                            item.kind === "tv" ? "?s=1&e=1" : ""
                          }`,
                        );
                      }}
                      className="inline-flex items-center gap-1 rounded-full bg-cyan-300/20 px-2.5 py-1 text-[11px] font-medium text-cyan-100 hover:bg-cyan-300/30"
                    >
                      <Play className="size-3" fill="currentColor" />
                      Play
                    </button>
                  </div>
                </div>
                <div className="mt-1 truncate text-sm font-medium text-white">
                  {item.title}
                </div>
              </button>
              <button
                onClick={() => remove.mutate(item.id)}
                className="absolute right-1.5 top-1.5 rounded-full bg-black/65 p-1.5 text-white/80 opacity-0 backdrop-blur transition-opacity hover:bg-black/85 group-hover:opacity-100"
                title="Remove from watchlist"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
