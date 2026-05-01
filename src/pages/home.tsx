import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tmdbImage } from "@/lib/tmdb";
import type { ContinueWatchingEntry } from "@/types";
import {
  Compass,
  Star,
  Globe2,
  RefreshCw,
  Newspaper,
  Music,
  Trophy,
  Film,
  Baby,
  Gamepad2,
  HeartPulse,
  Radio,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/api";
import { BentoCard, BentoGrid } from "@/components/ui/bento-grid";
import { BackgroundGradient } from "@/components/ui/background-gradient";

const CATEGORY_ICON: Record<string, LucideIcon> = {
  news: Newspaper,
  music: Music,
  sports: Trophy,
  movies: Film,
  series: Film,
  kids: Baby,
  family: Baby,
  general: Radio,
  entertainment: Film,
  documentary: Film,
  religious: HeartPulse,
  lifestyle: HeartPulse,
  classic: Film,
  cooking: HeartPulse,
  business: Newspaper,
  weather: Newspaper,
  education: Newspaper,
  comedy: Film,
  animation: Gamepad2,
  shop: Gamepad2,
};

function iconFor(cat: string): LucideIcon {
  return CATEGORY_ICON[cat.toLowerCase()] ?? Radio;
}

function describe(cat: string): string {
  const c = cat.toLowerCase();
  if (c === "sports") return "Live games, highlights, and analysis";
  if (c === "news") return "World news and local headlines";
  if (c === "music") return "Music videos and concerts";
  if (c === "movies") return "Movies on demand";
  if (c === "kids") return "Cartoons and family-friendly shows";
  if (c === "general") return "A bit of everything";
  if (c === "entertainment") return "Reality, talk shows, and more";
  if (c === "documentary") return "Documentaries and real stories";
  if (c === "religious") return "Faith and spirituality";
  if (c === "lifestyle") return "Lifestyle and wellness";
  if (c === "education") return "Educational programming";
  if (c === "business") return "Business and finance";
  if (c === "weather") return "Weather and forecasts";
  return "";
}

export function HomePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: cats = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: api.categories,
  });
  const { data: countries = [] } = useQuery({
    queryKey: ["countries"],
    queryFn: api.countries,
  });
  const { data: favorites = [] } = useQuery({
    queryKey: ["favorites"],
    queryFn: api.listFavorites,
  });

  const { data: continueWatching = [] } = useQuery({
    queryKey: ["vod", "continueWatching"],
    queryFn: api.vodContinueWatching,
  });

  const refresh = useMutation({
    mutationFn: api.refreshStreams,
    onSuccess: () => qc.invalidateQueries(),
  });

  const totalChannels = cats.reduce((acc, c) => acc + c.count, 0);

  return (
    <div className="@container flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold @lg:text-3xl">Welcome back</h1>
          <p className="text-sm text-white/60">
            {totalChannels.toLocaleString()} channels available ·{" "}
            {favorites.length} in your favorites
          </p>
        </div>
        <button
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="glass glass-hover inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm"
        >
          <RefreshCw
            className={`size-4 ${refresh.isPending ? "animate-spin" : ""}`}
          />
          {refresh.isPending ? "Updating…" : "Update channels"}
        </button>
      </header>

      <BackgroundGradient containerClassName="w-full">
        <div className="flex flex-col gap-2 px-5 py-6 @md:px-6 @md:py-8">
          <span className="text-xs text-white/50">Featured</span>
          <h2 className="text-xl font-semibold @md:text-2xl">
            Free live TV from around the world
          </h2>
          <p className="max-w-2xl text-sm text-white/60">
            Sports, news, music, kids, movies — channels from iptv-org and
            several community lists, all in one place.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to="/browse"
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-300/20 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-300/30"
            >
              <Compass className="size-4" />
              Browse channels
            </Link>
            <Link
              to="/favorites"
              className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-sm font-medium text-white/80 hover:bg-white/15"
            >
              <Star className="size-4" />
              Favorites
            </Link>
          </div>
        </div>
      </BackgroundGradient>

      {continueWatching.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-base font-semibold">Continue watching</h3>
          <div className="-mx-2 flex gap-3 overflow-x-auto px-2 pb-2">
            {continueWatching.map((item) => (
              <ContinueCard key={`${item.id}:${item.season}:${item.episode}`} item={item} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-base font-semibold">Browse by category</h3>
          <Link
            to="/browse"
            className="text-xs text-cyan-200 hover:text-cyan-100"
          >
            See all
          </Link>
        </div>
        <BentoGrid>
          {cats.slice(0, 6).map((c) => {
            const Icon = iconFor(c.value);
            const blurb = describe(c.value);
            const description = blurb
              ? `${c.count.toLocaleString()} channels · ${blurb}`
              : `${c.count.toLocaleString()} channels`;
            return (
              <BentoCard
                key={c.value}
                title={c.value.charAt(0).toUpperCase() + c.value.slice(1)}
                description={description}
                icon={<Icon className="size-4" />}
                onClick={() =>
                  navigate(`/browse?category=${encodeURIComponent(c.value)}`)
                }
              />
            );
          })}
        </BentoGrid>
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold">Browse by country</h3>
        <div className="flex flex-wrap gap-1.5">
          {countries.slice(0, 24).map((c) => (
            <button
              key={c.value}
              onClick={() =>
                navigate(`/browse?country=${encodeURIComponent(c.value)}`)
              }
              className="glass glass-hover inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
            >
              <Globe2 className="size-3 text-white/50" />
              <span className="font-medium">{c.value}</span>
              <span className="text-white/50">{c.count}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ContinueCard({ item }: { item: ContinueWatchingEntry }) {
  const navigate = useNavigate();
  const url = tmdbImage(item.backdrop_path ?? item.poster_path, "w500");
  const subtitle =
    item.kind === "tv" && item.season !== null && item.episode !== null
      ? `S${item.season} · E${item.episode}`
      : item.kind === "movie"
        ? "Movie"
        : "Series";
  const watchPath =
    item.kind === "tv" && item.season !== null && item.episode !== null
      ? `/watch/tv/${item.id.split(":")[1]}?s=${item.season}&e=${item.episode}`
      : `/watch/${item.kind}/${item.id.split(":")[1]}`;
  return (
    <button
      onClick={() => navigate(watchPath)}
      className="group flex w-72 shrink-0 flex-col gap-2 text-left"
    >
      <div className="relative h-40 overflow-hidden rounded-xl border border-white/10 bg-white/5">
        {url ? (
          <img
            src={url}
            alt={item.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="h-full w-full bg-white/5" />
        )}
        <div className="absolute inset-0 bg-linear-to-t from-black/70 via-transparent" />
        <div className="absolute bottom-2 left-2 right-2">
          <div className="text-xs text-white/70">{subtitle}</div>
          <div className="truncate text-sm font-medium text-white">
            {item.title}
          </div>
        </div>
      </div>
    </button>
  );
}
