import { useNavigate } from "react-router-dom";
import { User } from "lucide-react";
import type { PersonHit } from "@/types";
import { tmdbImage } from "@/lib/tmdb";

export function PersonTile({ person }: { person: PersonHit }) {
  const navigate = useNavigate();
  const url = tmdbImage(person.profile_path, "w185");
  return (
    <button
      onClick={() => navigate(`/people/${person.tmdb_id}`)}
      className="group flex w-32 shrink-0 flex-col gap-1.5 text-left"
    >
      <div className="aspect-[2/3] overflow-hidden rounded-xl border border-white/10 bg-white/5 transition-transform duration-200 group-hover:scale-[1.03]">
        {url ? (
          <img
            src={url}
            alt={person.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/30">
            <User className="size-8" />
          </div>
        )}
      </div>
      <div className="px-0.5">
        <div className="truncate text-sm font-medium text-white group-hover:text-cyan-200">
          {person.name}
        </div>
        {person.known_for_department && (
          <div className="text-[11px] text-white/45">
            {person.known_for_department}
          </div>
        )}
        {person.known_for.length > 0 && (
          <div className="mt-0.5 line-clamp-2 text-[11px] text-white/55">
            {person.known_for.join(" · ")}
          </div>
        )}
      </div>
    </button>
  );
}

export function PersonRow({
  title,
  people,
}: {
  title: string;
  people: PersonHit[];
}) {
  if (people.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-white/80">{title}</h3>
      <div className="-mx-2 flex gap-3 overflow-x-auto px-2 pb-2">
        {people.map((p) => (
          <PersonTile key={p.tmdb_id} person={p} />
        ))}
      </div>
    </section>
  );
}
