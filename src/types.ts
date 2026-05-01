export type ChannelRow = {
  channel: string;
  name: string | null;
  url: string;
  quality: string | null;
  label: string | null;
  referrer: string | null;
  user_agent: string | null;
  favorite: boolean;
  country: string | null;
  logo: string | null;
  categories: string[];
  source_id: string | null;
};

export type Source = {
  id: string;
  name: string;
  url: string;
  kind: "legal" | "aggregator" | "user" | string;
  description: string | null;
  enabled: boolean;
  last_refreshed_at: number | null;
  last_count: number;
  last_error: string | null;
  user_added: boolean;
};

export type AcestreamEngineStatus = {
  installed: boolean;
  version: string | null;
  host: string;
  binary_present: boolean;
  download_url: string;
  platform_supported: boolean;
  platform: "macos" | "windows" | "linux" | "other";
};

export type AcestreamHistoryEntry = {
  content_id: string;
  title: string | null;
  last_played_at: number;
  favorite: boolean;
};

export type AcestreamPlayResult = {
  url: string;
  content_id: string;
};

export type AcestreamPrepare = {
  infohash: string;
  session_id: string;
  stat_url: string;
  command_url: string;
  manifest_url: string;
  is_live: boolean;
};

export type AcestreamStat = {
  status: string | null;
  peers: number | null;
  speed_down: number | null;
  progress: number | null;
  downloaded: number | null;
  error: string | null;
};

export type AcestreamSearchHit = {
  content_id: string;
  name: string;
  bitrate: number | null;
  categories: string[];
  countries: string[];
  languages: string[];
  icon: string | null;
  availability: number | null;
  now_playing: string | null;
};

export type SportEvent = {
  id: string;
  title: string;
  home: string | null;
  away: string | null;
  home_badge: string | null;
  away_badge: string | null;
  league: string | null;
  league_badge: string | null;
  country: string | null;
  sport: string;
  sport_label: string;
  timestamp: number | null;
  status: string | null;
  is_live: boolean;
};

export type EnginePhase =
  | { kind: "not_provisioned" }
  | { kind: "provisioning"; progress: number; message: string }
  | { kind: "stopped" }
  | { kind: "starting" }
  | { kind: "running"; since: number }
  | { kind: "stopping" }
  | { kind: "error"; message: string };

export type DriverKind = "bundled_vm" | "external" | "unsupported";

export type RadioStation = {
  uuid: string;
  name: string;
  url: string;
  url_resolved: string | null;
  homepage: string | null;
  favicon: string | null;
  country: string | null;
  state: string | null;
  language: string | null;
  tags: string[];
  codec: string | null;
  bitrate: number | null;
  hls: boolean;
  last_check_ok: boolean;
  click_count: number;
  favorite: boolean;
  curated: boolean;
  referer: string | null;
  user_agent: string | null;
};

export type EngineRuntimeInfo = {
  driver: DriverKind;
  state: {
    phase: EnginePhase;
    host: string | null;
    last_error: string | null;
  };
  host: string;
};

export type ChannelDetail = {
  channel: string;
  streams: ChannelRow[];
};

export type ListQuery = {
  search?: string;
  category?: string;
  country?: string;
  quality?: string;
  limit?: number;
  offset?: number;
  favorites_only?: boolean;
};

export type FacetCount = {
  value: string;
  count: number;
};

export type RefreshResult = {
  streams: number;
  channels: number;
  guides: number;
  external: number;
};

export type ProgramInfo = {
  title: string;
  description: string | null;
  start_at: number;
  stop_at: number;
};

export type NowPlaying = {
  current: ProgramInfo | null;
  next: ProgramInfo | null;
  available: boolean;
};

export type PosterCard = {
  id: string;
  kind: "movie" | "tv";
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string | null;
  release_date: string | null;
  vote_average: number | null;
  original_language: string | null;
};

export type SeasonInfo = {
  season_number: number;
  name: string;
  episode_count: number;
  overview: string | null;
  poster_path: string | null;
};

export type EpisodeInfo = {
  season_number: number;
  episode_number: number;
  name: string;
  overview: string | null;
  still_path: string | null;
  air_date: string | null;
  runtime: number | null;
};

export type PersonHit = {
  tmdb_id: number;
  name: string;
  profile_path: string | null;
  known_for_department: string | null;
  known_for: string[];
};

export type SearchResults = {
  titles: PosterCard[];
  people: PersonHit[];
};

export type PersonDetail = {
  tmdb_id: number;
  name: string;
  profile_path: string | null;
  biography: string | null;
  birthday: string | null;
  place_of_birth: string | null;
  known_for_department: string | null;
  credits: PosterCard[];
};

export type CastMember = {
  tmdb_id: number;
  name: string;
  character: string | null;
  profile_path: string | null;
};

export type CrewMember = {
  name: string;
  job: string;
  profile_path: string | null;
};

export type ProductionCompany = {
  name: string;
  logo_path: string | null;
};

export type VodDetail = {
  id: string;
  kind: "movie" | "tv";
  tmdb_id: number;
  title: string;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | null;
  runtime: number | null;
  vote_average: number | null;
  genres: string[];
  seasons: SeasonInfo[];
  cast: CastMember[];
  crew: CrewMember[];
  production_companies: ProductionCompany[];
  tagline: string | null;
};

export type GenreEntry = { id: number; name: string };

export type DiscoverQuery = {
  kind: "movie" | "tv";
  genre_id?: number | null;
  year?: number | null;
  year_from?: number | null;
  year_to?: number | null;
  sort?: string | null;
  page?: number | null;
  language?: string | null;
  region?: string | null;
  min_rating?: number | null;
  min_votes?: number | null;
  runtime_min?: number | null;
  runtime_max?: number | null;
  keyword?: string | null;
};

export type ContinueWatchingEntry = {
  id: string;
  kind: "movie" | "tv";
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  season: number | null;
  episode: number | null;
  last_played_at: number;
  provider: string | null;
};

export type EmbedProvider = "vidsrc" | "2embed" | "autoembed";

export type WatchlistEntry = {
  id: string;
  kind: "movie" | "tv";
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string | null;
  vote_average: number | null;
  added_at: number;
};

export type VodPlaying = {
  mediaId: string;
  kind: "movie" | "tv";
  tmdbId: number;
  season: number | null;
  episode: number | null;
  provider: EmbedProvider;
  title: string;
  posterPath: string | null;
  runtimeMin: number | null;
};
