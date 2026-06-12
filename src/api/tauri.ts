import { invoke } from "@tauri-apps/api/core";
import type {
  AcestreamEngineStatus,
  AcestreamHistoryEntry,
  AcestreamPlayResult,
  AcestreamPrepare,
  AcestreamSearchHit,
  AcestreamStat,
  SportEvent,
  EngineRuntimeInfo,
  RadioStation,
  ChannelDetail,
  ChannelRow,
  ContinueWatchingEntry,
  EmbedProvider,
  EpisodeInfo,
  WatchlistEntry,
  FacetCount,
  ListQuery,
  NowPlaying,
  PersonDetail,
  PosterCard,
  RefreshResult,
  SearchResults,
  Source,
  VodDetail,
} from "../types";

export const tauriApi = {
  refreshStreams: () => invoke<RefreshResult>("cmd_refresh_streams"),
  listChannels: (query: ListQuery = {}) =>
    invoke<ChannelRow[]>("cmd_list_channels", { query }),
  getChannel: (channel: string) =>
    invoke<ChannelDetail>("cmd_get_channel", { channel }),
  proxyUrl: (url: string, referrer: string | null, userAgent: string | null) =>
    invoke<string>("cmd_proxy_url", {
      url,
      referrer: referrer ?? null,
      userAgent: userAgent ?? null,
    }),
  setFavorite: (channel: string, favorite: boolean) =>
    invoke<void>("cmd_set_favorite", { channel, favorite }),
  listFavorites: () => invoke<string[]>("cmd_list_favorites"),
  categories: () => invoke<FacetCount[]>("cmd_categories"),
  countries: () => invoke<FacetCount[]>("cmd_countries"),
  nowPlaying: (channel: string) =>
    invoke<NowPlaying>("cmd_now_playing", { channel }),
  listSources: () => invoke<Source[]>("cmd_list_sources"),
  setSourceEnabled: (id: string, enabled: boolean) =>
    invoke<number>("cmd_set_source_enabled", { id, enabled }),

  vodSetApiKey: (key: string) =>
    invoke<void>("cmd_vod_set_api_key", { key }),
  vodHasApiKey: () => invoke<boolean>("cmd_vod_has_api_key"),
  vodBrowse: (list: string) =>
    invoke<PosterCard[]>("cmd_vod_browse", { list }),
  vodSearch: (query: string) =>
    invoke<SearchResults>("cmd_vod_search", { query }),
  vodPerson: (tmdbId: number) =>
    invoke<PersonDetail>("cmd_vod_person", { tmdbId }),
  vodDetail: (kind: "movie" | "tv", tmdbId: number) =>
    invoke<VodDetail>("cmd_vod_detail", { kind, tmdbId }),
  vodEpisodes: (tvId: number, season: number) =>
    invoke<EpisodeInfo[]>("cmd_vod_episodes", { tvId, season }),
  vodEmbedUrl: (
    provider: EmbedProvider,
    kind: "movie" | "tv",
    tmdbId: number,
    season: number | null,
    episode: number | null,
  ) =>
    invoke<string>("cmd_vod_embed_url", {
      provider,
      kind,
      tmdbId,
      season,
      episode,
    }),
  vodSaveProgress: (
    mediaId: string,
    season: number | null,
    episode: number | null,
    provider: string | null,
    completed: boolean,
  ) =>
    invoke<void>("cmd_vod_save_progress", {
      mediaId,
      season,
      episode,
      provider,
      completed,
    }),
  vodContinueWatching: () =>
    invoke<ContinueWatchingEntry[]>("cmd_vod_continue_watching"),
  vodMarkCompleted: (mediaId: string) =>
    invoke<void>("cmd_vod_mark_completed", { mediaId }),
  vodClearProgress: (mediaId: string) =>
    invoke<void>("cmd_vod_clear_progress", { mediaId }),
  vodWatchlistAdd: (mediaId: string) =>
    invoke<void>("cmd_vod_watchlist_add", { mediaId }),
  vodWatchlistRemove: (mediaId: string) =>
    invoke<void>("cmd_vod_watchlist_remove", { mediaId }),
  vodWatchlistHas: (mediaId: string) =>
    invoke<boolean>("cmd_vod_watchlist_has", { mediaId }),
  vodWatchlistList: () => invoke<WatchlistEntry[]>("cmd_vod_watchlist_list"),
  vodGenres: (kind: "movie" | "tv") =>
    invoke<import("../types").GenreEntry[]>("cmd_vod_genres", { kind }),
  vodDiscover: (query: import("../types").DiscoverQuery) =>
    invoke<PosterCard[]>("cmd_vod_discover", { query }),

  addUserSource: (name: string, url: string) =>
    invoke<string>("cmd_add_user_source", { name, url }),
  removeUserSource: (id: string) =>
    invoke<void>("cmd_remove_user_source", { id }),

  acestreamStatus: () =>
    invoke<AcestreamEngineStatus>("cmd_acestream_status"),
  acestreamPlay: (input: string, title: string | null) =>
    invoke<AcestreamPlayResult>("cmd_acestream_play", { input, title }),
  acestreamHistory: () =>
    invoke<AcestreamHistoryEntry[]>("cmd_acestream_history"),
  acestreamToggleFavorite: (contentId: string) =>
    invoke<boolean>("cmd_acestream_toggle_favorite", { contentId }),
  acestreamDelete: (contentId: string) =>
    invoke<void>("cmd_acestream_delete", { contentId }),
  acestreamLaunch: () => invoke<boolean>("cmd_acestream_launch"),
  acestreamOpenDownload: () => invoke<void>("cmd_acestream_open_download"),
  acestreamSchedule: (date?: string) =>
    invoke<SportEvent[]>("cmd_acestream_schedule", { date: date ?? null }),
  acestreamSearch: (query: string) =>
    invoke<AcestreamSearchHit[]>("cmd_acestream_search", { query }),
  acestreamPrepare: (contentId: string) =>
    invoke<AcestreamPrepare>("cmd_acestream_prepare", { contentId }),
  acestreamStat: (statUrl: string) =>
    invoke<AcestreamStat>("cmd_acestream_stat", { statUrl }),
  acestreamStopSession: (commandUrl: string) =>
    invoke<void>("cmd_acestream_stop_session", { commandUrl }),
  engineGetHost: () => invoke<string>("cmd_engine_get_host"),
  engineSetHost: (host: string) =>
    invoke<void>("cmd_engine_set_host", { host }),
  engineRuntimeStatus: () =>
    invoke<EngineRuntimeInfo>("cmd_engine_runtime_status"),
  engineStart: () => invoke<void>("cmd_engine_start"),
  engineStop: () => invoke<void>("cmd_engine_stop"),

  healthRecordOk: (channel: string, url: string) =>
    invoke<void>("cmd_health_record_ok", { channel, url }),
  healthRecordFail: (channel: string, url: string) =>
    invoke<number>("cmd_health_record_fail", { channel, url }),

  radioRefresh: () => invoke<number>("cmd_radio_refresh"),
  radioList: (search?: string) =>
    invoke<RadioStation[]>("cmd_radio_list", { search: search ?? null }),
  radioSetFavorite: (uuid: string, favorite: boolean) =>
    invoke<void>("cmd_radio_set_favorite", { uuid, favorite }),
  radioClick: (uuid: string) =>
    invoke<void>("cmd_radio_click", { uuid }),
};
