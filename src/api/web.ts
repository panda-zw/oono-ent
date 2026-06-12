// Web-only api implementation used by the iPad WKWebView build.
//
// Same surface as `tauriApi` (see ./tauri.ts) but goes directly to TMDb,
// iptv-org, and the radio-browser API from the webview. Local state
// (watchlist, continue-watching, favourites, sources, settings) lives in
// localStorage. The IPTV HLS proxy is delegated to the Swift
// `WKURLSchemeHandler` registered in `ios/OonoEnt/HLSProxyHandler.swift`.
//
// Anything that needs the bundled VM (acestream*, engine*) throws a clear
// "not supported on iPad" error so callers can show a sensible UI.

import type {
  AcestreamEngineStatus,
  AcestreamHistoryEntry,
  AcestreamPlayResult,
  AcestreamPrepare,
  AcestreamSearchHit,
  AcestreamStat,
  CastMember,
  ChannelDetail,
  ChannelRow,
  ContinueWatchingEntry,
  CrewMember,
  DiscoverQuery,
  EmbedProvider,
  EngineRuntimeInfo,
  EpisodeInfo,
  FacetCount,
  GenreEntry,
  ListQuery,
  NowPlaying,
  PersonDetail,
  PersonHit,
  PosterCard,
  ProductionCompany,
  RadioStation,
  RefreshResult,
  SearchResults,
  SeasonInfo,
  Source,
  SportEvent,
  VodDetail,
  WatchlistEntry,
} from "../types";

// ──────────────────────────────────────────────────────────────────────────────
// localStorage helpers
// ──────────────────────────────────────────────────────────────────────────────

const LS_PREFIX = "oono-ent:";

function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota or serialization failure — silently drop. Caller decides.
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// TMDb client
// ──────────────────────────────────────────────────────────────────────────────

const TMDB_BASE = "https://api.themoviedb.org/3";

// Build-time fallback so iPad sideload builds can ship a baked-in key
// (see vite.config.ios.ts + .env.local). Falls back to "" when not set;
// localStorage always wins so the user can override at runtime.
declare const __OONO_DEFAULT_TMDB_KEY__: string;

function getTmdbKey(): string {
  const key = lsGet<string>("tmdb-key") || __OONO_DEFAULT_TMDB_KEY__;
  if (!key) throw new Error("Add a TMDb API key in Settings to browse movies and series");
  return key;
}

async function tmdbFetch<T = unknown>(path: string, params: Record<string, string | number | boolean | undefined | null> = {}): Promise<T> {
  const key = getTmdbKey();
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`TMDb ${path} → ${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

type TmdbAny = Record<string, unknown>;

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseCard(value: TmdbAny, defaultKind: "movie" | "tv"): PosterCard | null {
  const mediaType = (typeof value.media_type === "string" ? value.media_type : defaultKind) as "movie" | "tv" | string;
  if (mediaType !== "movie" && mediaType !== "tv") return null;
  const tmdbId = asNumber(value.id);
  if (tmdbId === null) return null;
  return {
    id: `${mediaType}:${tmdbId}`,
    kind: mediaType,
    tmdb_id: tmdbId,
    title: asString(value.title) ?? asString(value.name) ?? "Unknown",
    poster_path: asString(value.poster_path),
    backdrop_path: asString(value.backdrop_path),
    overview: asString(value.overview),
    release_date: asString(value.release_date) ?? asString(value.first_air_date),
    vote_average: asNumber(value.vote_average),
    original_language: asString(value.original_language),
  };
}

const BROWSE_LISTS: Record<string, { endpoint: string; kind: "movie" | "tv" }> = {
  trending: { endpoint: "/trending/all/week", kind: "movie" },
  popular_movies: { endpoint: "/movie/popular", kind: "movie" },
  top_rated_movies: { endpoint: "/movie/top_rated", kind: "movie" },
  now_playing_movies: { endpoint: "/movie/now_playing", kind: "movie" },
  popular_tv: { endpoint: "/tv/popular", kind: "tv" },
  top_rated_tv: { endpoint: "/tv/top_rated", kind: "tv" },
  on_the_air_tv: { endpoint: "/tv/on_the_air", kind: "tv" },
};

async function vodBrowse(list: string): Promise<PosterCard[]> {
  const spec = BROWSE_LISTS[list];
  if (!spec) throw new Error(`Unknown browse list: ${list}`);
  const body = await tmdbFetch<{ results: TmdbAny[] }>(spec.endpoint);
  return (body.results ?? []).map((v) => parseCard(v, spec.kind)).filter((c): c is PosterCard => c !== null);
}

async function vodSearch(query: string): Promise<SearchResults> {
  const body = await tmdbFetch<{ results: TmdbAny[] }>("/search/multi", {
    query,
    include_adult: false,
  });
  const titles: PosterCard[] = [];
  const people: PersonHit[] = [];
  for (const item of body.results ?? []) {
    const mediaType = typeof item.media_type === "string" ? item.media_type : null;
    if (mediaType === "person") {
      const tmdbId = asNumber(item.id);
      if (tmdbId === null) continue;
      const knownFor = Array.isArray(item.known_for)
        ? (item.known_for as TmdbAny[])
            .map((kf) => asString(kf.title) ?? asString(kf.name))
            .filter((v): v is string => v !== null)
        : [];
      people.push({
        tmdb_id: tmdbId,
        name: asString(item.name) ?? "Unknown",
        profile_path: asString(item.profile_path),
        known_for_department: asString(item.known_for_department),
        known_for: knownFor,
      });
    } else if (mediaType === "movie" || mediaType === "tv") {
      const c = parseCard(item, mediaType);
      if (c) titles.push(c);
    }
  }
  return { titles, people };
}

async function vodPerson(tmdbId: number): Promise<PersonDetail> {
  const body = await tmdbFetch<TmdbAny>(`/person/${tmdbId}`, {
    append_to_response: "combined_credits",
  });
  const cast = ((body.combined_credits as TmdbAny | undefined)?.cast as TmdbAny[] | undefined) ?? [];
  const credits = cast
    .map((c) => parseCard(c, "movie"))
    .filter((c): c is PosterCard => c !== null);
  return {
    tmdb_id: tmdbId,
    name: asString(body.name) ?? "Unknown",
    profile_path: asString(body.profile_path),
    biography: asString(body.biography),
    birthday: asString(body.birthday),
    place_of_birth: asString(body.place_of_birth),
    known_for_department: asString(body.known_for_department),
    credits,
  };
}

function pickCrew(credits: TmdbAny | undefined): CrewMember[] {
  const raw = ((credits as TmdbAny | undefined)?.crew as TmdbAny[] | undefined) ?? [];
  return raw
    .filter((c) => {
      const job = asString(c.job) ?? "";
      return ["Director", "Writer", "Screenplay", "Story", "Creator", "Executive Producer"].includes(job);
    })
    .slice(0, 12)
    .map((c) => ({
      name: asString(c.name) ?? "Unknown",
      job: asString(c.job) ?? "",
      profile_path: asString(c.profile_path),
    }));
}

function pickCast(credits: TmdbAny | undefined): CastMember[] {
  const raw = ((credits as TmdbAny | undefined)?.cast as TmdbAny[] | undefined) ?? [];
  return raw.slice(0, 24).map((c) => ({
    tmdb_id: asNumber(c.id) ?? 0,
    name: asString(c.name) ?? "Unknown",
    character: asString(c.character),
    profile_path: asString(c.profile_path),
  }));
}

async function vodDetail(kind: "movie" | "tv", tmdbId: number): Promise<VodDetail> {
  const body = await tmdbFetch<TmdbAny>(`/${kind}/${tmdbId}`, {
    append_to_response: "credits,videos",
  });
  const credits = body.credits as TmdbAny | undefined;
  const seasonsRaw = (body.seasons as TmdbAny[] | undefined) ?? [];
  const seasons: SeasonInfo[] = seasonsRaw
    .filter((s) => (asNumber(s.season_number) ?? -1) >= 1)
    .map((s) => ({
      season_number: asNumber(s.season_number) ?? 0,
      name: asString(s.name) ?? "",
      episode_count: asNumber(s.episode_count) ?? 0,
      overview: asString(s.overview),
      poster_path: asString(s.poster_path),
    }));
  const genres = ((body.genres as TmdbAny[] | undefined) ?? [])
    .map((g) => asString(g.name))
    .filter((v): v is string => v !== null);
  const companies: ProductionCompany[] = ((body.production_companies as TmdbAny[] | undefined) ?? []).map((c) => ({
    name: asString(c.name) ?? "",
    logo_path: asString(c.logo_path),
  }));
  return {
    id: `${kind}:${tmdbId}`,
    kind,
    tmdb_id: tmdbId,
    title: asString(body.title) ?? asString(body.name) ?? "Unknown",
    overview: asString(body.overview),
    poster_path: asString(body.poster_path),
    backdrop_path: asString(body.backdrop_path),
    release_date: asString(body.release_date) ?? asString(body.first_air_date),
    runtime:
      asNumber(body.runtime) ??
      asNumber(((body.episode_run_time as number[] | undefined) ?? [])[0]),
    vote_average: asNumber(body.vote_average),
    genres,
    seasons,
    cast: pickCast(credits),
    crew: pickCrew(credits),
    production_companies: companies,
    tagline: asString(body.tagline),
  };
}

async function vodEpisodes(tvId: number, season: number): Promise<EpisodeInfo[]> {
  const body = await tmdbFetch<TmdbAny>(`/tv/${tvId}/season/${season}`);
  const episodes = (body.episodes as TmdbAny[] | undefined) ?? [];
  return episodes.map((e) => ({
    season_number: asNumber(e.season_number) ?? season,
    episode_number: asNumber(e.episode_number) ?? 0,
    name: asString(e.name) ?? "",
    overview: asString(e.overview),
    still_path: asString(e.still_path),
    air_date: asString(e.air_date),
    runtime: asNumber(e.runtime),
  }));
}

async function vodGenres(kind: "movie" | "tv"): Promise<GenreEntry[]> {
  const body = await tmdbFetch<{ genres: TmdbAny[] }>(`/genre/${kind}/list`);
  return (body.genres ?? [])
    .map((g) => {
      const id = asNumber(g.id);
      const name = asString(g.name);
      return id !== null && name !== null ? { id, name } : null;
    })
    .filter((g): g is GenreEntry => g !== null);
}

async function vodDiscover(query: DiscoverQuery): Promise<PosterCard[]> {
  const params: Record<string, string | number | undefined | null> = {
    sort_by: query.sort ?? "popularity.desc",
    page: query.page ?? 1,
    with_genres: query.genre_id ?? undefined,
    language: query.language ?? undefined,
    region: query.region ?? undefined,
    "vote_average.gte": query.min_rating ?? undefined,
    "vote_count.gte": query.min_votes ?? undefined,
    with_keywords: query.keyword ?? undefined,
  };
  const dateField = query.kind === "movie" ? "primary_release_date" : "first_air_date";
  if (query.year) {
    params[`${dateField}.gte`] = `${query.year}-01-01`;
    params[`${dateField}.lte`] = `${query.year}-12-31`;
  }
  if (query.year_from) params[`${dateField}.gte`] = `${query.year_from}-01-01`;
  if (query.year_to) params[`${dateField}.lte`] = `${query.year_to}-12-31`;
  if (query.runtime_min) params["with_runtime.gte"] = query.runtime_min;
  if (query.runtime_max) params["with_runtime.lte"] = query.runtime_max;
  const body = await tmdbFetch<{ results: TmdbAny[] }>(`/discover/${query.kind}`, params);
  return (body.results ?? []).map((v) => parseCard(v, query.kind)).filter((c): c is PosterCard => c !== null);
}

// ──────────────────────────────────────────────────────────────────────────────
// Embed URL builder — mirrors src-tauri/src/vod.rs::build_embed_url
// ──────────────────────────────────────────────────────────────────────────────

function buildEmbedUrl(
  provider: EmbedProvider,
  kind: "movie" | "tv",
  tmdbId: number,
  season: number | null,
  episode: number | null,
): string {
  const s = season ?? 1;
  const e = episode ?? 1;
  switch (provider) {
    case "vidsrc":
      return kind === "movie"
        ? `https://vidsrc.to/embed/movie/${tmdbId}`
        : `https://vidsrc.to/embed/tv/${tmdbId}/${s}/${e}`;
    case "2embed":
      return kind === "movie"
        ? `https://www.2embed.cc/embed/${tmdbId}`
        : `https://www.2embed.cc/embedtv/${tmdbId}?s=${s}&e=${e}`;
    case "autoembed":
      return kind === "movie"
        ? `https://autoembed.co/movie/tmdb/${tmdbId}`
        : `https://autoembed.co/tv/tmdb/${tmdbId}-${s}-${e}`;
    case "vidlink":
      return kind === "movie"
        ? `https://vidlink.pro/movie/${tmdbId}`
        : `https://vidlink.pro/tv/${tmdbId}/${s}/${e}`;
    default:
      return `https://vidsrc.to/embed/${kind}/${tmdbId}`;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// VOD progress / watchlist (local-only)
// ──────────────────────────────────────────────────────────────────────────────

type ProgressRow = {
  media_id: string;
  kind: "movie" | "tv";
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  season: number | null;
  episode: number | null;
  last_played_at: number;
  completed: boolean;
  provider: string | null;
};

const PROGRESS_KEY = "vod-progress";
const WATCHLIST_KEY = "vod-watchlist";

function loadProgress(): Record<string, ProgressRow> {
  return lsGet<Record<string, ProgressRow>>(PROGRESS_KEY) ?? {};
}

function saveProgressMap(map: Record<string, ProgressRow>): void {
  lsSet(PROGRESS_KEY, map);
}

async function decorateProgress(mediaId: string): Promise<Pick<ProgressRow, "kind" | "tmdb_id" | "title" | "poster_path" | "backdrop_path"> | null> {
  // mediaId is "<kind>:<tmdb_id>". Fetch detail lazily so continue-watching
  // entries have nice posters even without prior browsing.
  const [kindRaw, idRaw] = mediaId.split(":");
  const kind = kindRaw === "tv" ? "tv" : "movie";
  const tmdbId = Number(idRaw);
  if (!Number.isFinite(tmdbId)) return null;
  try {
    const detail = await vodDetail(kind, tmdbId);
    return {
      kind,
      tmdb_id: tmdbId,
      title: detail.title,
      poster_path: detail.poster_path,
      backdrop_path: detail.backdrop_path,
    };
  } catch {
    return { kind, tmdb_id: tmdbId, title: mediaId, poster_path: null, backdrop_path: null };
  }
}

async function vodSaveProgress(
  mediaId: string,
  season: number | null,
  episode: number | null,
  provider: string | null,
  completed: boolean,
): Promise<void> {
  const map = loadProgress();
  const existing = map[mediaId];
  const decoration = existing
    ? { kind: existing.kind, tmdb_id: existing.tmdb_id, title: existing.title, poster_path: existing.poster_path, backdrop_path: existing.backdrop_path }
    : await decorateProgress(mediaId);
  if (!decoration) return;
  map[mediaId] = {
    media_id: mediaId,
    ...decoration,
    season,
    episode,
    last_played_at: Math.floor(Date.now() / 1000),
    completed,
    provider,
  };
  saveProgressMap(map);
}

async function vodContinueWatching(): Promise<ContinueWatchingEntry[]> {
  const map = loadProgress();
  return Object.values(map)
    .filter((row) => !row.completed)
    .sort((a, b) => b.last_played_at - a.last_played_at)
    .slice(0, 24)
    .map((row) => ({
      id: row.media_id,
      kind: row.kind,
      title: row.title,
      poster_path: row.poster_path,
      backdrop_path: row.backdrop_path,
      season: row.season,
      episode: row.episode,
      last_played_at: row.last_played_at,
      provider: row.provider,
    }));
}

async function vodMarkCompleted(mediaId: string): Promise<void> {
  const map = loadProgress();
  if (map[mediaId]) {
    map[mediaId].completed = true;
    saveProgressMap(map);
  }
}

async function vodClearProgress(mediaId: string): Promise<void> {
  const map = loadProgress();
  delete map[mediaId];
  saveProgressMap(map);
}

function loadWatchlist(): Record<string, WatchlistEntry> {
  return lsGet<Record<string, WatchlistEntry>>(WATCHLIST_KEY) ?? {};
}

function saveWatchlist(map: Record<string, WatchlistEntry>): void {
  lsSet(WATCHLIST_KEY, map);
}

async function vodWatchlistAdd(mediaId: string): Promise<void> {
  const map = loadWatchlist();
  if (map[mediaId]) return;
  const decoration = await decorateProgress(mediaId);
  if (!decoration) return;
  // Fetch a tiny detail call to capture overview/rating for the watchlist card.
  let overview: string | null = null;
  let voteAverage: number | null = null;
  try {
    const detail = await vodDetail(decoration.kind, decoration.tmdb_id);
    overview = detail.overview;
    voteAverage = detail.vote_average;
  } catch {
    // ignore — we already have the basics
  }
  map[mediaId] = {
    id: mediaId,
    kind: decoration.kind,
    tmdb_id: decoration.tmdb_id,
    title: decoration.title,
    poster_path: decoration.poster_path,
    backdrop_path: decoration.backdrop_path,
    overview,
    vote_average: voteAverage,
    added_at: Math.floor(Date.now() / 1000),
  };
  saveWatchlist(map);
}

async function vodWatchlistRemove(mediaId: string): Promise<void> {
  const map = loadWatchlist();
  delete map[mediaId];
  saveWatchlist(map);
}

async function vodWatchlistHas(mediaId: string): Promise<boolean> {
  return mediaId in loadWatchlist();
}

async function vodWatchlistList(): Promise<WatchlistEntry[]> {
  const map = loadWatchlist();
  return Object.values(map).sort((a, b) => b.added_at - a.added_at);
}

// ──────────────────────────────────────────────────────────────────────────────
// IPTV — fetch+filter against iptv-org public JSON
// ──────────────────────────────────────────────────────────────────────────────

type IptvStream = {
  channel: string | null;
  feed: string | null;
  url: string;
  http_referrer: string | null;
  user_agent: string | null;
  quality: string | null;
  timeshift: string | null;
};

type IptvChannel = {
  id: string;
  name: string;
  country: string | null;
  categories: string[] | null;
  logo: string | null;
};

let iptvCache: { channels: ChannelRow[]; loadedAt: number } | null = null;
const IPTV_TTL_MS = 6 * 60 * 60 * 1000;

const FAVORITES_KEY = "iptv-favorites";

function loadFavorites(): Set<string> {
  const arr = lsGet<string[]>(FAVORITES_KEY) ?? [];
  return new Set(arr);
}

function saveFavorites(set: Set<string>): void {
  lsSet(FAVORITES_KEY, Array.from(set));
}

async function loadIptv(force = false): Promise<ChannelRow[]> {
  if (!force && iptvCache && Date.now() - iptvCache.loadedAt < IPTV_TTL_MS) {
    return iptvCache.channels;
  }
  const [streamsR, channelsR] = await Promise.all([
    fetch("https://iptv-org.github.io/api/streams.json"),
    fetch("https://iptv-org.github.io/api/channels.json"),
  ]);
  if (!streamsR.ok || !channelsR.ok) throw new Error("iptv-org fetch failed");
  const streams = (await streamsR.json()) as IptvStream[];
  const channels = (await channelsR.json()) as IptvChannel[];
  const byId = new Map<string, IptvChannel>();
  for (const c of channels) byId.set(c.id, c);
  const favs = loadFavorites();
  const rows: ChannelRow[] = [];
  for (const s of streams) {
    if (!s.channel || !s.url) continue;
    const ch = byId.get(s.channel);
    if (!ch) continue;
    rows.push({
      channel: s.channel,
      name: ch.name,
      url: s.url,
      quality: s.quality,
      label: s.feed,
      referrer: s.http_referrer,
      user_agent: s.user_agent,
      favorite: favs.has(s.channel),
      country: ch.country,
      logo: ch.logo,
      categories: ch.categories ?? [],
      source_id: "iptv-org",
    });
  }
  iptvCache = { channels: rows, loadedAt: Date.now() };
  return rows;
}

async function listChannels(query: ListQuery = {}): Promise<ChannelRow[]> {
  let rows = await loadIptv();
  if (query.search) {
    const q = query.search.toLowerCase();
    rows = rows.filter(
      (r) =>
        (r.name?.toLowerCase().includes(q) ?? false) ||
        r.channel.toLowerCase().includes(q),
    );
  }
  if (query.category) {
    const c = query.category.toLowerCase();
    rows = rows.filter((r) => r.categories.some((cat) => cat.toLowerCase() === c));
  }
  if (query.country) {
    const c = query.country.toUpperCase();
    rows = rows.filter((r) => r.country?.toUpperCase() === c);
  }
  if (query.quality) {
    rows = rows.filter((r) => r.quality === query.quality);
  }
  if (query.favorites_only) {
    rows = rows.filter((r) => r.favorite);
  }
  const offset = query.offset ?? 0;
  const limit = query.limit ?? rows.length;
  return rows.slice(offset, offset + limit);
}

async function getChannel(channel: string): Promise<ChannelDetail> {
  const rows = (await loadIptv()).filter((r) => r.channel === channel);
  return { channel, streams: rows };
}

function proxyUrl(url: string, referrer: string | null, userAgent: string | null): string {
  const params = new URLSearchParams({ u: url });
  if (referrer) params.set("r", referrer);
  if (userAgent) params.set("ua", userAgent);
  return `oono-hls://stream?${params.toString()}`;
}

async function setFavorite(channel: string, favorite: boolean): Promise<void> {
  const favs = loadFavorites();
  if (favorite) favs.add(channel);
  else favs.delete(channel);
  saveFavorites(favs);
  if (iptvCache) {
    for (const r of iptvCache.channels) {
      if (r.channel === channel) r.favorite = favorite;
    }
  }
}

async function listFavorites(): Promise<string[]> {
  return Array.from(loadFavorites());
}

async function categories(): Promise<FacetCount[]> {
  const rows = await loadIptv();
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const c of r.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

async function countries(): Promise<FacetCount[]> {
  const rows = await loadIptv();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.country) continue;
    counts.set(r.country, (counts.get(r.country) ?? 0) + 1);
  }
  return Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

async function refreshStreams(): Promise<RefreshResult> {
  const rows = await loadIptv(true);
  const channelIds = new Set(rows.map((r) => r.channel));
  return { streams: rows.length, channels: channelIds.size, guides: 0, external: 0 };
}

async function nowPlaying(_channel: string): Promise<NowPlaying> {
  return { current: null, next: null, available: false };
}

// Sources — iPad build keeps it simple: iptv-org only, with on/off toggle.
type SourceRow = Source;
const SOURCES_KEY = "iptv-sources";

function defaultSources(): SourceRow[] {
  return [
    {
      id: "iptv-org",
      name: "iptv-org public catalogue",
      url: "https://iptv-org.github.io/api/streams.json",
      kind: "aggregator",
      description: "Global crowdsourced IPTV channel index",
      enabled: true,
      last_refreshed_at: iptvCache ? Math.floor(iptvCache.loadedAt / 1000) : null,
      last_count: iptvCache?.channels.length ?? 0,
      last_error: null,
      user_added: false,
    },
  ];
}

async function listSources(): Promise<Source[]> {
  return lsGet<SourceRow[]>(SOURCES_KEY) ?? defaultSources();
}

async function setSourceEnabled(id: string, enabled: boolean): Promise<number> {
  const list = await listSources();
  const next = list.map((s) => (s.id === id ? { ...s, enabled } : s));
  lsSet(SOURCES_KEY, next);
  return next.filter((s) => s.enabled).length;
}

async function addUserSource(_name: string, _url: string): Promise<string> {
  throw new Error("Adding custom IPTV sources isn't supported in the iPad build yet");
}

async function removeUserSource(_id: string): Promise<void> {
  throw new Error("Removing IPTV sources isn't supported in the iPad build yet");
}

// Health is a noop on iPad — we can't run aggressive health checks in the
// background, and the UI is tolerant of always-zero counts.
async function healthRecordOk(_channel: string, _url: string): Promise<void> {}
async function healthRecordFail(_channel: string, _url: string): Promise<number> { return 0; }

// ──────────────────────────────────────────────────────────────────────────────
// Radio — fetch from radio-browser.info
// ──────────────────────────────────────────────────────────────────────────────

const RADIO_BASE = "https://de1.api.radio-browser.info/json";
const RADIO_FAVS_KEY = "radio-favorites";
const RADIO_CACHE_KEY = "radio-cache";

type RadioFavSet = Set<string>;

function loadRadioFavs(): RadioFavSet {
  return new Set(lsGet<string[]>(RADIO_FAVS_KEY) ?? []);
}

function saveRadioFavs(set: RadioFavSet): void {
  lsSet(RADIO_FAVS_KEY, Array.from(set));
}

type RawRadioStation = {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved?: string;
  homepage?: string;
  favicon?: string;
  country?: string;
  state?: string;
  language?: string;
  tags?: string;
  codec?: string;
  bitrate?: number;
  hls?: number | boolean;
  lastcheckok?: number | boolean;
  clickcount?: number;
};

function toRadioStation(s: RawRadioStation, favs: RadioFavSet): RadioStation {
  return {
    uuid: s.stationuuid,
    name: s.name,
    url: s.url,
    url_resolved: s.url_resolved ?? null,
    homepage: s.homepage ?? null,
    favicon: s.favicon ?? null,
    country: s.country ?? null,
    state: s.state ?? null,
    language: s.language ?? null,
    tags: (s.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    codec: s.codec ?? null,
    bitrate: s.bitrate ?? null,
    hls: Boolean(s.hls),
    last_check_ok: Boolean(s.lastcheckok),
    click_count: s.clickcount ?? 0,
    favorite: favs.has(s.stationuuid),
    curated: false,
    referer: null,
    user_agent: null,
  };
}

async function radioRefresh(): Promise<number> {
  const r = await fetch(`${RADIO_BASE}/stations/bycountrycodeexact/zw?hidebroken=true&order=clickcount&reverse=true&limit=200`);
  if (!r.ok) throw new Error(`radio-browser ${r.status}`);
  const raw = (await r.json()) as RawRadioStation[];
  lsSet(RADIO_CACHE_KEY, raw);
  return raw.length;
}

async function radioList(search?: string | null): Promise<RadioStation[]> {
  let raw = lsGet<RawRadioStation[]>(RADIO_CACHE_KEY);
  if (!raw) {
    await radioRefresh();
    raw = lsGet<RawRadioStation[]>(RADIO_CACHE_KEY) ?? [];
  }
  const favs = loadRadioFavs();
  let list = raw.map((s) => toRadioStation(s, favs));
  if (search) {
    const q = search.toLowerCase();
    list = list.filter((s) => s.name.toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q)));
  }
  list.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.click_count - a.click_count);
  return list;
}

async function radioSetFavorite(uuid: string, favorite: boolean): Promise<void> {
  const favs = loadRadioFavs();
  if (favorite) favs.add(uuid);
  else favs.delete(uuid);
  saveRadioFavs(favs);
}

async function radioClick(uuid: string): Promise<void> {
  // Fire-and-forget click counter ping; ignore failures.
  fetch(`${RADIO_BASE}/url/${uuid}`).catch(() => undefined);
}

// ──────────────────────────────────────────────────────────────────────────────
// Acestream / engine — not supported on iPad
// ──────────────────────────────────────────────────────────────────────────────

const NOT_ON_IPAD = "Live sports (Acestream) isn't available on iPad";
const ENGINE_NOT_ON_IPAD = "Acestream engine controls aren't available on iPad";

function acestreamStatus(): Promise<AcestreamEngineStatus> {
  return Promise.resolve({
    installed: false,
    version: null,
    host: "",
    binary_present: false,
    download_url: "",
    platform_supported: false,
    platform: "other",
  });
}

function notSupported<T>(message: string): Promise<T> {
  return Promise.reject(new Error(message));
}

function engineRuntimeStatus(): Promise<EngineRuntimeInfo> {
  return Promise.resolve({
    driver: "unsupported",
    state: { phase: { kind: "not_provisioned" }, host: null, last_error: null },
    host: "",
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Exported web api — same shape as tauriApi
// ──────────────────────────────────────────────────────────────────────────────

export const webApi = {
  refreshStreams,
  listChannels,
  getChannel,
  proxyUrl: async (url: string, referrer: string | null, userAgent: string | null) =>
    proxyUrl(url, referrer, userAgent),
  setFavorite,
  listFavorites,
  categories,
  countries,
  nowPlaying,
  listSources,
  setSourceEnabled,

  vodSetApiKey: async (key: string) => {
    lsSet("tmdb-key", key);
  },
  vodHasApiKey: async () =>
    Boolean(lsGet<string>("tmdb-key") || __OONO_DEFAULT_TMDB_KEY__),
  vodBrowse,
  vodSearch,
  vodPerson,
  vodDetail,
  vodEpisodes,
  vodEmbedUrl: async (
    provider: EmbedProvider,
    kind: "movie" | "tv",
    tmdbId: number,
    season: number | null,
    episode: number | null,
  ) => buildEmbedUrl(provider, kind, tmdbId, season, episode),
  vodSaveProgress,
  vodContinueWatching,
  vodMarkCompleted,
  vodClearProgress,
  vodWatchlistAdd,
  vodWatchlistRemove,
  vodWatchlistHas,
  vodWatchlistList,
  vodGenres,
  vodDiscover,

  addUserSource,
  removeUserSource,

  acestreamStatus,
  acestreamPlay: (_input: string, _title: string | null): Promise<AcestreamPlayResult> => notSupported(NOT_ON_IPAD),
  acestreamHistory: async (): Promise<AcestreamHistoryEntry[]> => [],
  acestreamToggleFavorite: (_contentId: string): Promise<boolean> => notSupported(NOT_ON_IPAD),
  acestreamDelete: (_contentId: string): Promise<void> => notSupported(NOT_ON_IPAD),
  acestreamLaunch: async (): Promise<boolean> => false,
  acestreamOpenDownload: async (): Promise<void> => {},
  acestreamSchedule: async (_date?: string): Promise<SportEvent[]> => [],
  acestreamSearch: async (_query: string): Promise<AcestreamSearchHit[]> => [],
  acestreamPrepare: (_contentId: string): Promise<AcestreamPrepare> => notSupported(NOT_ON_IPAD),
  acestreamStat: (_statUrl: string): Promise<AcestreamStat> => notSupported(NOT_ON_IPAD),
  acestreamStopSession: async (_commandUrl: string): Promise<void> => {},
  engineGetHost: async (): Promise<string> => "",
  engineSetHost: (_host: string): Promise<void> => notSupported(ENGINE_NOT_ON_IPAD),
  engineRuntimeStatus,
  engineStart: (): Promise<void> => notSupported(ENGINE_NOT_ON_IPAD),
  engineStop: (): Promise<void> => notSupported(ENGINE_NOT_ON_IPAD),

  healthRecordOk,
  healthRecordFail,

  radioRefresh,
  radioList,
  radioSetFavorite,
  radioClick,
};
