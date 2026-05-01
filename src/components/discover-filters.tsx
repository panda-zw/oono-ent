import { useQuery } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import { api } from "@/api";
import { cn } from "@/lib/utils";

export type DiscoverState = {
  genreId: number | null;
  year: number | null;
  sort: string;
};

export const DISCOVER_DEFAULT: DiscoverState = {
  genreId: null,
  year: null,
  sort: "popularity.desc",
};

const SORTS_MOVIE: Array<{ value: string; label: string }> = [
  { value: "popularity.desc", label: "Most popular" },
  { value: "vote_average.desc", label: "Top rated" },
  { value: "primary_release_date.desc", label: "Newest" },
  { value: "primary_release_date.asc", label: "Oldest" },
  { value: "revenue.desc", label: "Box office" },
];

const SORTS_TV: Array<{ value: string; label: string }> = [
  { value: "popularity.desc", label: "Most popular" },
  { value: "vote_average.desc", label: "Top rated" },
  { value: "first_air_date.desc", label: "Newest" },
  { value: "first_air_date.asc", label: "Oldest" },
];

export function DiscoverFilters({
  kind,
  state,
  onChange,
}: {
  kind: "movie" | "tv";
  state: DiscoverState;
  onChange: (next: DiscoverState) => void;
}) {
  const genres = useQuery({
    queryKey: ["vod", "genres", kind],
    queryFn: () => api.vodGenres(kind),
  });

  const sortOptions = kind === "tv" ? SORTS_TV : SORTS_MOVIE;
  const currentYear = new Date().getFullYear();
  const years: (number | null)[] = [null];
  for (let y = currentYear; y >= 1960; y--) years.push(y);

  const isFiltered = state.genreId !== null || state.year !== null || state.sort !== "popularity.desc";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Picker
        label="Genre"
        value={
          state.genreId
            ? genres.data?.find((g) => g.id === state.genreId)?.name
            : null
        }
        onClear={
          state.genreId !== null
            ? () => onChange({ ...state, genreId: null })
            : undefined
        }
      >
        <select
          value={state.genreId ?? ""}
          onChange={(e) =>
            onChange({
              ...state,
              genreId: e.target.value ? Number(e.target.value) : null,
            })
          }
          className="cursor-pointer appearance-none bg-transparent pr-5 text-sm text-white outline-none"
        >
          <option value="" className="bg-neutral-900 text-white">
            Any genre
          </option>
          {genres.data?.map((g) => (
            <option key={g.id} value={g.id} className="bg-neutral-900 text-white">
              {g.name}
            </option>
          ))}
        </select>
      </Picker>
      <Picker
        label="Year"
        value={state.year ?? null}
        onClear={
          state.year !== null
            ? () => onChange({ ...state, year: null })
            : undefined
        }
      >
        <select
          value={state.year ?? ""}
          onChange={(e) =>
            onChange({
              ...state,
              year: e.target.value ? Number(e.target.value) : null,
            })
          }
          className="cursor-pointer appearance-none bg-transparent pr-5 text-sm text-white outline-none"
        >
          {years.map((y) => (
            <option key={y ?? "any"} value={y ?? ""} className="bg-neutral-900 text-white">
              {y ?? "Any year"}
            </option>
          ))}
        </select>
      </Picker>
      <Picker
        label="Sort"
        value={
          sortOptions.find((s) => s.value === state.sort)?.label ?? "Custom"
        }
      >
        <select
          value={state.sort}
          onChange={(e) => onChange({ ...state, sort: e.target.value })}
          className="cursor-pointer appearance-none bg-transparent pr-5 text-sm text-white outline-none"
        >
          {sortOptions.map((s) => (
            <option key={s.value} value={s.value} className="bg-neutral-900 text-white">
              {s.label}
            </option>
          ))}
        </select>
      </Picker>
      {isFiltered && (
        <button
          onClick={() => onChange(DISCOVER_DEFAULT)}
          className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
        >
          <X className="size-3" />
          Reset
        </button>
      )}
    </div>
  );
}

function Picker({
  label,
  value,
  onClear,
  children,
}: {
  label: string;
  value: string | number | null | undefined;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  const active = value !== null && value !== undefined && value !== "";
  return (
    <div
      className={cn(
        "relative flex items-center gap-1 rounded-full border px-3 py-1 text-xs",
        active
          ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100"
          : "border-white/10 bg-white/5 text-white/70",
      )}
    >
      <span className="text-white/40">{label}:</span>
      {children}
      <ChevronDown className="size-3 text-white/40" />
      {onClear && (
        <button
          onClick={onClear}
          className="rounded-full p-0.5 hover:bg-white/15"
          aria-label="Clear"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
