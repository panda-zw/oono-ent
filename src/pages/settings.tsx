import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ExternalLink,
  Film,
  KeyRound,
  Layers,
  Link2,
  Loader2,
  Monitor,
  Plus,
  RefreshCw,
  ShieldCheck,
  SkipForward,
  Trash2,
  Tv,
  User,
  Zap,
  Gauge,
  Leaf,
} from "lucide-react";
import { api } from "@/api";
import { useAppStore, type QualityPreference } from "@/store";
import { cn } from "@/lib/utils";
import type { Source } from "@/types";

export function SettingsPage() {
  const qc = useQueryClient();
  const refresh = useMutation({
    mutationFn: api.refreshStreams,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth);
  const setPlayerWidth = useAppStore((s) => s.setPlayerWidth);
  const qualityPreference = useAppStore((s) => s.qualityPreference);
  const setQualityPreference = useAppStore((s) => s.setQualityPreference);
  const vodAutoplay = useAppStore((s) => s.vodAutoplay);
  const setVodAutoplay = useAppStore((s) => s.setVodAutoplay);

  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: api.listSources,
  });

  const hasTmdb = useQuery({
    queryKey: ["vod", "hasKey"],
    queryFn: api.vodHasApiKey,
  });
  const [tmdbInput, setTmdbInput] = useState("");
  useEffect(() => {
    if (hasTmdb.data) setTmdbInput("");
  }, [hasTmdb.data]);
  const saveTmdb = useMutation({
    mutationFn: (key: string) => api.vodSetApiKey(key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vod"] });
    },
  });

  const toggleSource = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.setSourceEnabled(id, enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  const addSource = useMutation({
    mutationFn: ({ name, url }: { name: string; url: string }) =>
      api.addUserSource(name, url),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });
  const removeSource = useMutation({
    mutationFn: (id: string) => api.removeUserSource(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const qualityOptions: Array<{
    id: QualityPreference;
    title: string;
    description: string;
    icon: React.ReactNode;
  }> = [
    {
      id: "best",
      title: "Best quality",
      description: "Use the highest quality your connection can handle",
      icon: <Zap className="size-4" />,
    },
    {
      id: "smart",
      title: "Smart",
      description: "Start safe, raise quality as your connection allows",
      icon: <Gauge className="size-4" />,
    },
    {
      id: "save",
      title: "Save data",
      description: "Stay on lower quality to save bandwidth",
      icon: <Leaf className="size-4" />,
    },
  ];

  return (
    <div className="@container flex h-full flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6">
        <header>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-white/60">
            Configure your channels, playback, and account.
          </p>
        </header>

        <Card
          icon={<RefreshCw className="size-4" />}
          title="Channels"
          description="Channels are pulled from a free public list. Update once a day to get the latest."
        >
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-300/20 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-300/30 disabled:opacity-50"
            >
              <RefreshCw
                className={cn("size-4", refresh.isPending && "animate-spin")}
              />
              {refresh.isPending ? "Updating…" : "Update now"}
            </button>
            {refresh.data && (
              <span className="text-xs text-white/50">
                {refresh.data.streams.toLocaleString()} streams ·{" "}
                {refresh.data.channels.toLocaleString()} channels
                {refresh.data.external > 0 &&
                  ` · ${refresh.data.external.toLocaleString()} extra`}
              </span>
            )}
          </div>
          {refresh.error && (
            <p className="text-xs text-red-400">{String(refresh.error)}</p>
          )}
        </Card>

        <Card
          icon={<KeyRound className="size-4" />}
          title="Movies & series"
          description="Powered by The Movie Database (TMDb). Paste your free API key to enable Movies and Series."
          badge={hasTmdb.data ? <ConnectedBadge /> : undefined}
        >
          <div className="grid grid-cols-1 gap-2 @md:grid-cols-[1fr_auto]">
            <input
              type="text"
              value={tmdbInput}
              onChange={(e) => setTmdbInput(e.target.value)}
              placeholder={
                hasTmdb.data
                  ? "Replace existing key…"
                  : "Paste TMDb v3 API key here"
              }
              className="w-full min-w-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-cyan-300/50 focus:outline-none"
            />
            <button
              onClick={() =>
                tmdbInput.trim() && saveTmdb.mutate(tmdbInput.trim())
              }
              disabled={saveTmdb.isPending || !tmdbInput.trim()}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-cyan-300/20 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-300/30 disabled:opacity-50"
            >
              {saveTmdb.isPending ? "Saving…" : "Save key"}
            </button>
          </div>
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1 text-xs text-white/60 hover:text-white/90"
          >
            Get a free TMDb key
            <ExternalLink className="size-3" />
          </a>
        </Card>

        <Card
          icon={<Gauge className="size-4" />}
          title="Stream quality"
          description="On a fast connection, pick Best quality. You can also override per stream from the player."
        >
          <div className="grid grid-cols-1 gap-2 @md:grid-cols-3">
            {qualityOptions.map((opt) => (
              <Tile
                key={opt.id}
                active={qualityPreference === opt.id}
                onClick={() => setQualityPreference(opt.id)}
                icon={opt.icon}
                title={opt.title}
                description={opt.description}
              />
            ))}
          </div>
        </Card>

        <Card
          icon={<SkipForward className="size-4" />}
          title="Auto-play next episode"
          description="When watching a series, automatically continue to the next episode."
        >
          <button
            onClick={() => setVodAutoplay(!vodAutoplay)}
            className={cn(
              "inline-flex w-fit items-center gap-2 rounded-full px-4 py-1.5 text-sm transition-colors",
              vodAutoplay
                ? "bg-cyan-300/20 text-cyan-100"
                : "bg-white/5 text-white/70 hover:bg-white/10",
            )}
          >
            <span
              className={cn(
                "relative inline-flex h-4 w-7 items-center rounded-full transition-colors",
                vodAutoplay ? "bg-cyan-400/80" : "bg-white/20",
              )}
            >
              <span
                className={cn(
                  "inline-block size-3 rounded-full bg-white transition-transform",
                  vodAutoplay ? "translate-x-3.5" : "translate-x-0.5",
                )}
              />
            </span>
            {vodAutoplay ? "On" : "Off"}
          </button>
        </Card>

        <Card
          icon={<Layers className="size-4" />}
          title="Layout"
          description="Drag the dividers between panels to resize them — sizes are remembered."
        >
          <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
            <Tile
              active={viewMode === "split"}
              onClick={() => setViewMode("split")}
              icon={<Tv className="size-4" />}
              title="Split view"
              description="Channel list and player side by side"
            />
            <Tile
              active={viewMode === "theater"}
              onClick={() => setViewMode("theater")}
              icon={<Monitor className="size-4" />}
              title="Theater mode"
              description="Video covers the whole window. Press Esc to exit."
            />
          </div>
          <button
            onClick={() => {
              setSidebarWidth(240);
              setPlayerWidth(640);
            }}
            className="inline-flex w-fit items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
          >
            Reset panel sizes
          </button>
        </Card>

        <Card
          icon={<Film className="size-4" />}
          title="Channel sources"
          description="Oono Ent combines multiple free channel lists out of the box. Turn off any source you don't want, or paste your own M3U URL below."
        >
          <div className="space-y-2">
            {sources.data?.map((src) => (
              <SourceRow
                key={src.id}
                src={src}
                loading={
                  (toggleSource.isPending &&
                    toggleSource.variables?.id === src.id) ||
                  (removeSource.isPending && removeSource.variables === src.id)
                }
                onToggle={(enabled) =>
                  toggleSource.mutate({ id: src.id, enabled })
                }
                onRemove={
                  src.user_added
                    ? () => removeSource.mutate(src.id)
                    : undefined
                }
              />
            ))}
            {!sources.data && (
              <p className="text-xs text-white/50">Loading…</p>
            )}
          </div>

          <div className="rounded-xl border border-dashed border-white/15 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-white/70">
              <Link2 className="size-3.5" />
              Add your own M3U playlist
            </div>
            <div className="grid grid-cols-1 gap-2 @md:grid-cols-[1fr_2fr_auto]">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name (e.g. My provider)"
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-cyan-300/50 focus:outline-none"
              />
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://example.com/playlist.m3u"
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-cyan-300/50 focus:outline-none"
              />
              <button
                onClick={() => {
                  if (!newName.trim() || !newUrl.trim()) return;
                  addSource.mutate(
                    { name: newName.trim(), url: newUrl.trim() },
                    {
                      onSuccess: () => {
                        setNewName("");
                        setNewUrl("");
                      },
                    },
                  );
                }}
                disabled={
                  addSource.isPending || !newName.trim() || !newUrl.trim()
                }
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-cyan-300/20 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-300/30 disabled:opacity-50"
              >
                <Plus className="size-4" />
                {addSource.isPending ? "Adding…" : "Add"}
              </button>
            </div>
            {addSource.error && (
              <p className="mt-1 text-xs text-red-300">
                {String(addSource.error)}
              </p>
            )}
          </div>
        </Card>

        <p className="text-center text-[11px] text-white/30">
          Streams are buffered for stability. Public IPTV streams come and go —
          if one won't play, try another.
        </p>
      </div>
    </div>
  );
}

function Card({
  icon,
  title,
  description,
  badge,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
      <div className="flex items-start gap-3">
        {icon && (
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-cyan-200">
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-medium text-white">{title}</h2>
            {badge}
          </div>
          {description && (
            <p className="mt-0.5 text-sm text-white/60">{description}</p>
          )}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ConnectedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-300/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
      <ShieldCheck className="size-3" />
      Connected
    </span>
  );
}

function Tile({
  active,
  onClick,
  icon,
  title,
  description,
}: {
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors",
        active
          ? "border-cyan-300/50 bg-cyan-300/10"
          : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10",
      )}
    >
      <div className="flex size-8 items-center justify-center rounded-lg bg-white/10 text-white/80">
        {icon}
      </div>
      <div>
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="text-xs text-white/50">{description}</div>
      </div>
    </button>
  );
}

function SourceRow({
  src,
  loading,
  onToggle,
  onRemove,
}: {
  src: Source;
  loading: boolean;
  onToggle: (enabled: boolean) => void;
  onRemove?: () => void;
}) {
  const isAggregator = src.kind === "aggregator";
  const isUser = src.user_added || src.kind === "user";
  const refreshed = src.last_refreshed_at
    ? new Date(src.last_refreshed_at * 1000).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3 transition-colors",
        src.enabled
          ? "border-cyan-300/30 bg-cyan-300/5"
          : "border-white/10 bg-white/3",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-white">
            {src.name}
          </span>
          {isUser ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-cyan-300/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-200">
              <User className="size-3" />
              Yours
            </span>
          ) : isAggregator ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-300/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
              <AlertTriangle className="size-3" />
              Community
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-300/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
              <ShieldCheck className="size-3" />
              Free legal
            </span>
          )}
        </div>
        {src.description && (
          <p className="mt-1 line-clamp-2 text-xs text-white/55">
            {src.description}
          </p>
        )}
        <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-white/40">
          {src.enabled && src.last_count > 0 && (
            <span>{src.last_count.toLocaleString()} channels</span>
          )}
          {refreshed && <span>Updated {refreshed}</span>}
          {src.last_error && (
            <span className="text-red-300">Failed to update</span>
          )}
        </div>
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          disabled={loading}
          className="rounded-md p-1.5 text-white/40 hover:bg-white/10 hover:text-red-300 disabled:opacity-50"
          title="Remove this playlist"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
      <button
        onClick={() => onToggle(!src.enabled)}
        disabled={loading}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          src.enabled ? "bg-cyan-400/80" : "bg-white/15",
          loading && "opacity-50",
        )}
        aria-label={src.enabled ? "Disable source" : "Enable source"}
      >
        {loading ? (
          <Loader2 className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 animate-spin text-white" />
        ) : (
          <span
            className={cn(
              "inline-block size-5 rounded-full bg-white transition-transform",
              src.enabled ? "translate-x-5" : "translate-x-0.5",
            )}
          />
        )}
      </button>
    </div>
  );
}
