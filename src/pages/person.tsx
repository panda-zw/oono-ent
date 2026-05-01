import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Loader2, User } from "lucide-react";
import { api } from "@/api";
import { tmdbImage } from "@/lib/tmdb";
import { PosterTile } from "@/components/poster-row";

export function PersonPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const tmdbId = Number(id);

  const person = useQuery({
    queryKey: ["person", tmdbId],
    queryFn: () => api.vodPerson(tmdbId),
    enabled: Number.isFinite(tmdbId) && tmdbId > 0,
  });

  if (person.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-white/60" />
      </div>
    );
  }
  if (person.error || !person.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-white/60">
        <p>Couldn't load this person.</p>
        <button
          onClick={() => navigate(-1)}
          className="rounded-full bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
        >
          Go back
        </button>
      </div>
    );
  }

  const p = person.data;
  const profile = tmdbImage(p.profile_path, "w342");

  return (
    <div className="@container flex h-full flex-col gap-6 overflow-y-auto p-6">
      <div>
        <button
          onClick={() => navigate(-1)}
          className="mb-3 inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
        >
          <ChevronLeft className="size-3.5" />
          Back
        </button>
        <div className="flex flex-col gap-5 @md:flex-row">
          <div className="size-48 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5">
            {profile ? (
              <img
                src={profile}
                alt={p.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/30">
                <User className="size-12" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <h1 className="text-3xl font-semibold">{p.name}</h1>
            {p.known_for_department && (
              <p className="text-sm text-white/60">{p.known_for_department}</p>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/55">
              {p.birthday && (
                <span>
                  Born <span className="text-white/80">{p.birthday}</span>
                </span>
              )}
              {p.place_of_birth && (
                <span className="text-white/80">{p.place_of_birth}</span>
              )}
            </div>
            {p.biography && (
              <p className="line-clamp-6 text-sm text-white/75">
                {p.biography}
              </p>
            )}
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Known for</h2>
          {p.credits.length > 0 && (
            <span className="text-xs text-white/40">
              {p.credits.length} title{p.credits.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {p.credits.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-white/50">
            No credits available.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @xl:grid-cols-4 @3xl:grid-cols-5">
            {p.credits.map((item) => (
              <PosterTile key={item.id} item={item} size="fill" />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
