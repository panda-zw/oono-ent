import { useEffect, useMemo, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Play,
  Power,
  Search as SearchIcon,
  Server,
  Star,
  Trash2,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import { api } from "@/api";
import { useAppStore } from "@/store";
import type { AcestreamSearchHit, ChannelRow, SportEvent } from "@/types";
import { cn } from "@/lib/utils";
import { SportsSchedule } from "@/components/sports-schedule";

function makeChannel(contentId: string, title: string | null): ChannelRow {
  const display = title?.trim() || `Live · ${contentId.slice(0, 8)}`;
  return {
    channel: `acestream.${contentId}`,
    name: display,
    url: `http://127.0.0.1:6878/ace/getstream?infohash=${contentId}&transcode_ac3=1&transcode_audio=1`,
    quality: null,
    label: "P2P sports",
    referrer: null,
    user_agent: null,
    favorite: false,
    country: null,
    logo: null,
    categories: ["sports"],
    source_id: "acestream",
  };
}

export function AcestreamPage() {
  const setCurrent = useAppStore((s) => s.setCurrent);
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [waitingForEngine, setWaitingForEngine] = useState(false);
  const [pendingEvent, setPendingEvent] = useState<SportEvent | null>(null);

  const status = useQuery({
    queryKey: ["acestream", "status"],
    queryFn: api.acestreamStatus,
    refetchInterval: waitingForEngine ? 2_000 : 30_000,
  });

  const runtime = useQuery({
    queryKey: ["engine", "runtime"],
    queryFn: api.engineRuntimeStatus,
    refetchInterval: 5_000,
  });

  const [hostInput, setHostInput] = useState("");
  useEffect(() => {
    if (runtime.data?.host && hostInput === "") {
      setHostInput(runtime.data.host);
    }
  }, [runtime.data?.host]);

  const setHost = useMutation({
    mutationFn: (host: string) => api.engineSetHost(host),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acestream", "status"] });
      qc.invalidateQueries({ queryKey: ["engine", "runtime"] });
    },
  });

  const engineStart = useMutation({
    mutationFn: () => api.engineStart(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["engine", "runtime"] });
      qc.invalidateQueries({ queryKey: ["acestream", "status"] });
    },
  });
  const engineStop = useMutation({
    mutationFn: () => api.engineStop(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["engine", "runtime"] });
      qc.invalidateQueries({ queryKey: ["acestream", "status"] });
    },
  });

  useEffect(() => {
    if (status.data?.installed && waitingForEngine) {
      setWaitingForEngine(false);
    }
  }, [status.data?.installed, waitingForEngine]);

  const [autoLaunchTried, setAutoLaunchTried] = useState(false);
  useEffect(() => {
    if (
      !autoLaunchTried &&
      status.data &&
      !status.data.installed &&
      status.data.binary_present
    ) {
      setAutoLaunchTried(true);
      api
        .acestreamLaunch()
        .then(() => setWaitingForEngine(true))
        .catch(() => {});
    }
  }, [status.data, autoLaunchTried]);

  const history = useQuery({
    queryKey: ["acestream", "history"],
    queryFn: api.acestreamHistory,
  });

  const launch = useMutation({
    mutationFn: api.acestreamLaunch,
    onSuccess: () => {
      setWaitingForEngine(true);
      setTimeout(
        () => qc.invalidateQueries({ queryKey: ["acestream", "status"] }),
        500,
      );
    },
  });

  const openDownload = useMutation({
    mutationFn: api.acestreamOpenDownload,
    onSuccess: () => setWaitingForEngine(true),
  });

  const play = useMutation({
    mutationFn: ({ raw, title }: { raw: string; title: string | null }) =>
      api.acestreamPlay(raw, title),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ["acestream", "history"] });
      setCurrent(makeChannel(res.content_id, vars.title));
      setInput("");
      setTitleInput("");
    },
  });

  const toggleFavorite = useMutation({
    mutationFn: (id: string) => api.acestreamToggleFavorite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["acestream", "history"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.acestreamDelete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["acestream", "history"] }),
  });

  const playSaved = (entry: { content_id: string; title: string | null }) => {
    setCurrent(makeChannel(entry.content_id, entry.title));
    play.mutate({ raw: entry.content_id, title: entry.title });
  };

  const engineReady = status.data?.installed === true;
  const engineMissing =
    status.data && !status.data.installed && !status.data.binary_present;
  const engineInstalledNotRunning =
    status.data && !status.data.installed && status.data.binary_present;

  return (
    <div className="@container flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold @lg:text-3xl">Live sports</h1>
        <p className="text-sm text-white/60">
          Peer-to-peer streams of football, basketball, F1 and more — popular
          matches usually look great.
        </p>
      </header>

      {!engineReady && runtime.data?.driver === "bundled_vm" && (
        <BundledVmCard
          phase={runtime.data.state.phase}
          starting={engineStart.isPending}
          stopping={engineStop.isPending}
          // When the VM phase says "running" but cmd_acestream_status can't
          // reach the engine HTTP API, the engine inside the VM has died or
          // the VSOCK transport got stuck. The user needs a clear restart
          // path, not a "Start engine" that does nothing.
          unresponsive={
            runtime.data.state.phase.kind === "running" && !engineReady
          }
          onStart={() => engineStart.mutate()}
          onStop={() => engineStop.mutate()}
          onRestart={async () => {
            try {
              await engineStop.mutateAsync();
            } catch {}
            try {
              await engineStart.mutateAsync();
            } catch {}
          }}
        />
      )}

      {!engineReady &&
        status.data?.platform_supported === false &&
        runtime.data?.driver !== "bundled_vm" && (
          <UnsupportedCard platform={status.data.platform} />
        )}

      {!engineReady && status.data?.platform_supported !== false && (
        <SetupCard
          waiting={waitingForEngine}
          missing={!!engineMissing}
          installedNotRunning={!!engineInstalledNotRunning}
          launching={launch.isPending}
          opening={openDownload.isPending}
          onLaunch={() => launch.mutate()}
          onDownload={() => openDownload.mutate()}
        />
      )}

      {!engineReady && (
        <RemoteHostCard
          driver={runtime.data?.driver ?? "external"}
          hostInput={hostInput}
          onChange={setHostInput}
          onSave={() => hostInput.trim() && setHost.mutate(hostInput.trim())}
          saving={setHost.isPending}
          currentHost={runtime.data?.host ?? ""}
        />
      )}

      {engineReady && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-300/30 bg-emerald-300/5 p-3">
          <CheckCircle2 className="size-5 text-emerald-300" />
          <div className="text-sm text-white/80">
            Streaming engine is running
            {status.data?.version && (
              <span className="text-white/50"> · v{status.data.version}</span>
            )}
          </div>
        </div>
      )}

      {engineReady && (
      <section
        className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl"
      >
        <h2 className="text-base font-medium">Play a stream</h2>
        <p className="text-sm text-white/60">
          Paste a stream link from a match thread — anything starting with{" "}
          <code className="rounded bg-white/10 px-1 py-0.5 text-[11px]">
            acestream://
          </code>{" "}
          or a 40-character ID will do.
        </p>
        <div className="grid grid-cols-1 gap-2 @md:grid-cols-[2fr_1fr_auto]">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="acestream://… or 40-char hex ID"
            disabled={!engineReady}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-cyan-300/50 focus:outline-none disabled:cursor-not-allowed"
          />
          <input
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            placeholder="Label (optional)"
            disabled={!engineReady}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-cyan-300/50 focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            onClick={() =>
              input.trim() &&
              play.mutate({
                raw: input.trim(),
                title: titleInput.trim() || null,
              })
            }
            disabled={play.isPending || !input.trim() || !engineReady}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-300/20 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-300/30 disabled:opacity-50"
          >
            <Play className="size-4" fill="currentColor" />
            {play.isPending ? "Starting…" : "Play"}
          </button>
        </div>
        {play.error && (
          <p className="text-xs text-red-300">{String(play.error)}</p>
        )}
      </section>
      )}

      {engineReady && (
        <ChannelBrowser
          onPlay={(hit) =>
            play.mutate({ raw: hit.content_id, title: hit.name })
          }
          playing={play.isPending}
        />
      )}

      {engineReady && (
        <SportsSchedule
          enabled={engineReady}
          onPickEvent={(event) => {
            setPendingEvent(event);
            setTitleInput(event.title);
          }}
        />
      )}

      {pendingEvent && (
        <MatchChannelPicker
          event={pendingEvent}
          submitting={play.isPending}
          onClose={() => setPendingEvent(null)}
          onPick={(hit) => {
            play.mutate(
              {
                raw: hit.content_id,
                title: `${pendingEvent.title} · ${hit.name}`,
              },
              {
                onSuccess: () => setPendingEvent(null),
              },
            );
          }}
        />
      )}

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-medium">Recent &amp; favorites</h2>
          {history.data && history.data.length > 0 && (
            <span className="text-xs text-white/40">
              {history.data.length} saved
            </span>
          )}
        </div>
        {history.data && history.data.length > 0 ? (
          <div className="space-y-1.5">
            {history.data.map((h) => (
              <div
                key={h.content_id}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-2.5"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-cyan-300/15 text-cyan-200">
                  {h.favorite ? (
                    <Star className="size-4" fill="currentColor" />
                  ) : (
                    <Activity className="size-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white">
                    {h.title?.trim() || `Stream ${h.content_id.slice(0, 12)}…`}
                  </div>
                  <div className="truncate font-mono text-[11px] text-white/40">
                    {h.content_id}
                  </div>
                </div>
                <button
                  onClick={() => toggleFavorite.mutate(h.content_id)}
                  className={cn(
                    "rounded-md p-1.5 transition-colors",
                    h.favorite
                      ? "text-amber-300 hover:bg-white/10"
                      : "text-white/40 hover:bg-white/10 hover:text-amber-300",
                  )}
                  title={h.favorite ? "Unfavorite" : "Favorite"}
                >
                  <Star
                    className="size-3.5"
                    fill={h.favorite ? "currentColor" : "none"}
                  />
                </button>
                <button
                  onClick={() => playSaved({ content_id: h.content_id, title: h.title })}
                  disabled={!engineReady}
                  className="inline-flex items-center gap-1 rounded-full bg-cyan-300/20 px-3 py-1 text-xs font-medium text-cyan-100 hover:bg-cyan-300/30 disabled:opacity-50"
                >
                  <Zap className="size-3" />
                  Play
                </button>
                <button
                  onClick={() => remove.mutate(h.content_id)}
                  className="rounded-md p-1.5 text-white/40 hover:bg-white/10 hover:text-red-300"
                  title="Remove"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-white/50">
            <Trophy className="mx-auto mb-2 size-5 text-white/40" />
            Nothing saved yet. Play any stream and it'll appear here.
          </div>
        )}
      </section>
    </div>
  );
}

function RemoteHostCard({
  driver,
  hostInput,
  onChange,
  onSave,
  saving,
  currentHost,
}: {
  driver: string;
  hostInput: string;
  onChange: (s: string) => void;
  onSave: () => void;
  saving: boolean;
  currentHost: string;
}) {
  const isUnsupported = driver === "unsupported";
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-cyan-300/15 text-cyan-200">
          <Server className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 className="text-base font-medium text-white">
              {isUnsupported
                ? "Connect to an engine on another machine"
                : "Use a different engine host"}
            </h2>
            <p className="mt-1 text-sm text-white/60">
              {isUnsupported
                ? "If you have a Windows or Linux machine on your network running Acestream, point Oono at it and live sports will work here too."
                : "Useful if you're running the engine on a Pi, NAS, or remote server. Defaults to 127.0.0.1:6878."}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 @md:grid-cols-[1fr_auto]">
            <input
              type="text"
              value={hostInput}
              onChange={(e) => onChange(e.target.value)}
              placeholder="192.168.1.10:6878"
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-cyan-300/50 focus:outline-none"
            />
            <button
              onClick={onSave}
              disabled={
                saving || !hostInput.trim() || hostInput.trim() === currentHost
              }
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-cyan-300/20 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-300/30 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Use this host"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BundledVmCard({
  phase,
  starting,
  stopping,
  unresponsive,
  onStart,
  onStop,
  onRestart,
}: {
  phase: import("@/types").EnginePhase;
  starting: boolean;
  stopping: boolean;
  unresponsive: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
}) {
  const label = unresponsive
    ? "Engine unresponsive"
    : phase.kind === "running"
      ? "Engine running"
      : phase.kind === "starting"
        ? "Starting…"
        : phase.kind === "stopping"
          ? "Stopping…"
          : phase.kind === "error"
            ? "Engine error"
            : phase.kind === "provisioning"
              ? `Provisioning ${Math.round(phase.progress * 100)}%`
              : "Engine idle";

  const detail = unresponsive
    ? "The engine inside the VM stopped responding. Restart it to recover — sessions, channels, and live sports will come back."
    : phase.kind === "error"
      ? phase.message
      : phase.kind === "provisioning"
        ? phase.message
        : phase.kind === "running"
          ? "The engine is up. Pick a channel from Browse channels below to start watching."
          : phase.kind === "starting"
            ? "Booting the bundled VM and the streaming engine."
            : phase.kind === "stopping"
              ? "Shutting the engine down."
              : "Click below to launch the bundled engine — no install required.";

  const isBusy =
    phase.kind === "starting" ||
    phase.kind === "stopping" ||
    starting ||
    stopping;

  const tone = unresponsive
    ? "border-amber-300/30 bg-amber-300/5"
    : phase.kind === "error"
      ? "border-red-400/30 bg-red-400/5"
      : "border-cyan-300/20 bg-cyan-300/5";
  const iconTone = unresponsive
    ? "bg-amber-300/15 text-amber-200"
    : phase.kind === "error"
      ? "bg-red-400/15 text-red-200"
      : "bg-cyan-300/15 text-cyan-200";

  return (
    <div className={cn("rounded-2xl border p-5", tone)}>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            iconTone,
          )}
        >
          {isBusy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : unresponsive ? (
            <AlertTriangle className="size-5" />
          ) : (
            <Power className="size-5" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h2 className="text-base font-medium text-white">Live sports engine</h2>
            <p className="mt-1 text-sm text-white/65">{label}</p>
            <p className="mt-1 text-xs text-white/45">{detail}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {unresponsive ? (
              <button
                onClick={onRestart}
                disabled={isBusy}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-300/20 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-300/30 disabled:opacity-50"
              >
                <Power className="size-4" />
                Restart engine
              </button>
            ) : (
              <button
                onClick={onStart}
                disabled={
                  starting ||
                  phase.kind === "starting" ||
                  phase.kind === "running"
                }
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-300/20 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-300/30 disabled:opacity-50"
              >
                <Power className="size-4" />
                Start engine
              </button>
            )}
            {phase.kind === "running" && !unresponsive && (
              <button
                onClick={onStop}
                disabled={stopping}
                className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-50"
              >
                Stop
              </button>
            )}
          </div>
          <p className="text-[11px] text-white/40">
            Bundled Linux VM via Apple Virtualization framework. ~5 second cold
            start. Streams stay on your machine.
          </p>
        </div>
      </div>
    </div>
  );
}

function UnsupportedCard({ platform }: { platform: string }) {
  const label = platform === "macos" ? "macOS" : platform;
  return (
    <div className="rounded-2xl border border-amber-300/30 bg-amber-300/5 p-5">
      <div className="flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-amber-300/15 text-amber-200">
          <AlertTriangle className="size-6" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 className="text-base font-semibold text-white">
              Live sports aren't available on {label}
            </h2>
            <p className="mt-1 text-sm text-white/65">
              The peer-to-peer streaming engine that powers this section is
              only published for Windows, Linux, Android, and Android TV. There
              is no official {label} build, so we can't run it here.
            </p>
            <p className="mt-2 text-xs text-white/50">
              If you have a Windows or Linux machine on your network, you can
              run the engine there and we'll add a "remote engine" option in a
              future update.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="https://docs.acestream.net/products/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15"
            >
              See supported platforms
              <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function SetupCard({
  waiting,
  missing,
  installedNotRunning,
  launching,
  opening,
  onLaunch,
  onDownload,
}: {
  waiting: boolean;
  missing: boolean;
  installedNotRunning: boolean;
  launching: boolean;
  opening: boolean;
  onLaunch: () => void;
  onDownload: () => void;
}) {
  if (waiting) {
    return (
      <div className="rounded-2xl border border-cyan-300/30 bg-cyan-300/5 p-5">
        <div className="flex items-start gap-3">
          <Loader2 className="mt-0.5 size-5 animate-spin text-cyan-200" />
          <div className="flex-1 space-y-1">
            <div className="text-sm font-medium text-white">
              Waiting for the streaming engine…
            </div>
            <p className="text-sm text-white/60">
              {installedNotRunning
                ? "Starting up. This usually takes a few seconds."
                : "Once you finish the installer, this page will turn green automatically."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
      <div className="flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-cyan-300/15 text-cyan-200">
          <Zap className="size-6" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 className="text-base font-semibold text-white">
              {installedNotRunning
                ? "Start the streaming engine"
                : "One-time setup for live sports"}
            </h2>
            <p className="mt-1 text-sm text-white/60">
              {installedNotRunning
                ? "We found the engine on your computer. Click below and we'll start it for you."
                : "Live P2P sports run through a small free engine made by Acestream. We'll guide you to install it — about a minute, then it just works in the background."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {installedNotRunning ? (
              <button
                onClick={onLaunch}
                disabled={launching}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-300/20 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-300/30 disabled:opacity-50"
              >
                <Power className="size-4" />
                {launching ? "Starting…" : "Start engine"}
              </button>
            ) : (
              <button
                onClick={onDownload}
                disabled={opening}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-300/20 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-300/30 disabled:opacity-50"
              >
                <Download className="size-4" />
                {opening ? "Opening download…" : "Set up streaming engine"}
              </button>
            )}
            {missing && (
              <button
                onClick={onLaunch}
                disabled={launching}
                className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10"
                title="If you've already installed it"
              >
                Already installed
              </button>
            )}
          </div>
          <p className="text-xs text-white/40">
            The engine is provided by Acestream. Oono Ent doesn't bundle it
            because of platform restrictions, but we handle everything around
            it so you don't have to think about it again.
          </p>
        </div>
      </div>
    </div>
  );
}

// Build smart engine queries for a sports event. The engine's `/search` index
// matches against channel NAMES, not leagues or sports — so "Soccer" returns 0
// hits but "Sky Sports" returns 5. We expand a single event into a chain of
// queries: known broadcasters for THIS league → distinctive league keywords →
// known broadcaster names for the sport → generic catch-alls. The dialog
// walks the chain until one returns a non-empty result.
const SPORT_CHANNEL_QUERIES: Record<string, string[]> = {
  soccer: [
    "sky sports",
    "tnt sports",
    "bein",
    "dazn",
    "espn",
    "premier",
    "football",
    "sport",
  ],
  americanfootball: ["nfl", "espn", "fox sports", "sport"],
  basketball: ["nba", "espn", "sport"],
  icehockey: ["nhl", "tsn", "sport"],
  baseball: ["mlb", "espn", "sport"],
  motorsport: ["f1", "formula", "dazn", "sport"],
  rugby: ["sky sports", "rugby", "sport"],
  cricket: ["sky sports cricket", "cricket", "willow", "sport"],
  tennis: ["tennis", "espn", "sport"],
  fighting: ["ufc", "espn", "sport"],
};

// Per-league broadcaster map. Each entry's key is a substring matched
// case-insensitively against the event's league name (whichever ESPN
// returned, e.g. "English Premier League" or "UEFA Europa League"). The
// values are channel-name queries known to exist in the Acestream catalog
// for that league's main rights-holders. Ordered with the strongest
// candidates first — the cascade will return the first non-empty result.
const LEAGUE_BROADCASTERS: Array<{ pattern: RegExp; queries: string[] }> = [
  // English football
  {
    pattern: /english premier league|premier league/i,
    queries: [
      "sky sports",
      "tnt sports",
      "premier sports",
      "nbc sports",
      "peacock",
    ],
  },
  {
    pattern: /english league championship|championship|english.+\bsecond/i,
    queries: ["sky sports", "tnt sports", "premier sports"],
  },
  {
    pattern: /fa cup|english fa cup/i,
    queries: ["bbc", "tnt sports", "espn"],
  },
  {
    pattern: /league cup|carabao cup|efl cup/i,
    queries: ["sky sports", "tnt sports"],
  },
  // UEFA — all three competitions are TNT Sports in UK, Paramount+/CBS in US
  {
    pattern: /uefa.*champions/i,
    queries: ["tnt sports", "movistar liga", "paramount", "cbs", "rmc sport"],
  },
  {
    pattern: /uefa.*europa.*conf/i,
    queries: ["tnt sports", "paramount", "rtl"],
  },
  {
    pattern: /uefa.*europa/i,
    queries: ["tnt sports", "paramount", "cbssn", "rmc sport"],
  },
  {
    pattern: /uefa.*nations/i,
    queries: ["uefa", "viaplay", "rtl"],
  },
  // Spanish football
  {
    pattern: /la ?liga|primera división|spanish.+league/i,
    queries: ["dazn la liga", "movistar laliga", "laliga", "espn deportes"],
  },
  {
    pattern: /copa del rey/i,
    queries: ["movistar copa", "rtve", "espn"],
  },
  // German football
  {
    pattern: /bundesliga/i,
    queries: ["sky bundesliga", "dazn bundesliga", "viaplay"],
  },
  { pattern: /dfb.?pokal/i, queries: ["sky bundesliga", "ard"] },
  // Italian football
  {
    pattern: /serie a|italian.+series/i,
    queries: ["dazn serie", "sky calcio", "paramount"],
  },
  { pattern: /coppa italia/i, queries: ["mediaset", "rai"] },
  // French football
  {
    pattern: /ligue 1|french.+league/i,
    queries: ["dazn ligue", "ligue1+", "bein sports"],
  },
  // Dutch / Portuguese / Turkish
  { pattern: /eredivisie|dutch/i, queries: ["espn", "ziggo sport"] },
  { pattern: /portuguese|primeira liga|liga portugal/i, queries: ["sport tv"] },
  { pattern: /süper lig|turkish/i, queries: ["bein sports"] },
  // South American football
  {
    pattern: /libertadores|sudamericana/i,
    queries: ["espn", "fox sports", "globo"],
  },
  { pattern: /brasileirão|brazilian/i, queries: ["globo", "premiere"] },
  { pattern: /argentine|argentina/i, queries: ["espn premium", "tnt sports"] },
  // International / FIFA
  {
    pattern: /fifa.+world cup|world cup/i,
    queries: ["bbc", "itv", "fox", "telemundo", "bein"],
  },
  { pattern: /world cup qual/i, queries: ["bein sports", "espn"] },
  // North American football
  { pattern: /mls|major league soccer/i, queries: ["apple tv", "espn", "fox"] },
  { pattern: /liga mx|mexican/i, queries: ["tudn", "espn"] },
  // North American leagues
  {
    pattern: /\bnba\b|national basketball/i,
    queries: ["nba tv", "espn", "tnt", "abc", "nbc"],
  },
  {
    pattern: /\bnfl\b|national football league/i,
    queries: ["nfl network", "espn", "fox", "cbs", "nbc", "amazon"],
  },
  {
    pattern: /college football|ncaa football/i,
    queries: ["espn", "abc", "fox", "cbs", "sec network"],
  },
  {
    pattern: /\bnhl\b|national hockey/i,
    queries: ["espn", "tnt", "sportsnet", "tsn"],
  },
  {
    pattern: /\bmlb\b|major league baseball/i,
    queries: ["mlb network", "espn", "fox sports", "tbs"],
  },
  // Motorsport / fight / cricket
  { pattern: /formula 1|\bf1\b/i, queries: ["sky sports f1", "espn", "viaplay"] },
  {
    pattern: /\bufc\b|mma|mixed martial/i,
    queries: ["espn", "tnt sports", "bt sport"],
  },
  { pattern: /icc|cricket world cup/i, queries: ["sky sports cricket", "willow"] },
];

function broadcastersForLeague(league: string | null): string[] {
  if (!league) return [];
  for (const entry of LEAGUE_BROADCASTERS) {
    if (entry.pattern.test(league)) return entry.queries;
  }
  return [];
}

const COMMON_STOPWORDS = new Set([
  "the",
  "of",
  "and",
  "or",
  "for",
  "men",
  "women",
  "u17",
  "u19",
  "u20",
  "u21",
  "u23",
  "qualifying",
  "qualifiers",
  "playoffs",
  "playoff",
  "regular",
  "season",
  "round",
  "group",
  "stage",
  "league",
  "cup",
  "div",
  "division",
  "1",
  "2",
  "3",
  "a",
  "b",
  "c",
]);

function leagueKeywords(league: string | null): string[] {
  if (!league) return [];
  return league
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !COMMON_STOPWORDS.has(w));
}

function eventQueries(event: SportEvent): string[] {
  const out: string[] = [];
  const push = (s: string | null | undefined) => {
    const v = s?.trim().toLowerCase();
    if (v && !out.includes(v)) out.push(v);
  };
  // 1. Broadcasters known to carry THIS league. This is the highest-signal
  //    source — Aston Villa @ Forest in the Europa League maps directly to
  //    "tnt sports" / "paramount", which match real channels in the engine.
  for (const q of broadcastersForLeague(event.league)) push(q);
  // 2. The league name itself, in case the engine has a league-branded
  //    channel like "Sky Sports Premier League".
  push(event.league ?? null);
  // 3. Distinctive keywords from the league name (4+ chars, not stopwords).
  for (const kw of leagueKeywords(event.league)) push(kw);
  // 4. Generic broadcasters for the sport (catch-all if league-specific
  //    didn't match anything in the catalog).
  for (const q of SPORT_CHANNEL_QUERIES[event.sport] ?? ["sport"]) push(q);
  // 5. Team-name fallbacks. Rarely match, but cheap to try.
  if (event.home && event.away) push(`${event.home} ${event.away}`);
  push(event.home);
  push(event.away);
  return out;
}

function MatchChannelPicker({
  event,
  onClose,
  onPick,
  submitting,
}: {
  event: SportEvent;
  onClose: () => void;
  onPick: (hit: AcestreamSearchHit) => void;
  submitting: boolean;
}) {
  const [customQuery, setCustomQuery] = useState<string | null>(null);

  const allQueries = useMemo(() => eventQueries(event), [event]);
  // Cap parallel fan-out so we don't hammer the engine with 10+ searches.
  // The cap is generous enough to cover league broadcasters + a few sport
  // catch-alls, which is where >95% of real matches live.
  const queries = useMemo(() => allQueries.slice(0, 8), [allQueries]);

  const customQ = customQuery?.trim() ?? "";
  const usingCustom = customQ.length > 0;

  // Fan out one search per candidate query in parallel and merge results.
  // This solves the "the first query returned 0 so we showed nothing"
  // problem: now we see channels matching ANY query, deduped by content_id
  // and ranked with the best signals first (league broadcaster matches
  // appear before generic sport-name matches).
  const queryResults = useQueries({
    queries: usingCustom
      ? [
          {
            queryKey: ["acestream", "search", "custom", customQ],
            queryFn: () => api.acestreamSearch(customQ),
            staleTime: 60_000,
          },
        ]
      : queries.map((q) => ({
          queryKey: ["acestream", "search", "match", q],
          queryFn: () => api.acestreamSearch(q),
          staleTime: 60_000,
        })),
  });

  type RankedHit = AcestreamSearchHit & {
    matchedQueries: string[];
    rank: number;
  };

  const { hits, anyLoading, completed } = useMemo(() => {
    const out = new Map<string, RankedHit>();
    let loading = 0;
    let done = 0;
    queryResults.forEach((r, i) => {
      if (r.isLoading) loading++;
      if (r.isSuccess || r.isError) done++;
      const data = r.data;
      if (!data) return;
      const queryLabel = usingCustom ? customQ : queries[i] ?? "";
      data.forEach((hit, posWithinQuery) => {
        const existing = out.get(hit.content_id);
        // Earlier queries (lower i) and earlier positions within a query
        // get a lower rank — ranking ascending = best first.
        const rank = i * 100 + posWithinQuery;
        if (!existing || rank < existing.rank) {
          out.set(hit.content_id, {
            ...hit,
            matchedQueries: existing
              ? Array.from(new Set([...existing.matchedQueries, queryLabel]))
              : [queryLabel],
            rank: existing ? Math.min(existing.rank, rank) : rank,
          });
        } else {
          existing.matchedQueries = Array.from(
            new Set([...existing.matchedQueries, queryLabel]),
          );
        }
      });
    });
    const ranked = Array.from(out.values()).sort((a, b) => {
      // Higher availability first, then higher bitrate, then lower rank.
      const aa = a.availability ?? 0;
      const ba = b.availability ?? 0;
      if (aa !== ba) return ba - aa;
      const ab = a.bitrate ?? 0;
      const bb = b.bitrate ?? 0;
      if (ab !== bb) return bb - ab;
      return a.rank - b.rank;
    });
    return { hits: ranked, anyLoading: loading > 0, completed: done };
  }, [queryResults, queries, usingCustom, customQ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-6 pt-20 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl space-y-4 rounded-2xl border border-white/10 bg-neutral-900/95 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-white/40">
              {event.league ?? event.sport_label}
            </div>
            <h3 className="mt-0.5 text-lg font-semibold text-white">
              {event.title}
            </h3>
            {event.is_live && (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-400/20 px-2 py-0.5 text-[10px] font-semibold text-red-200">
                <span className="size-1 animate-pulse rounded-full bg-red-400" />
                LIVE
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-white/40">
            {usingCustom ? "Custom query:" : "Trying:"}
          </span>
          {(usingCustom ? [customQ] : queries).map((q) => (
            <span
              key={q}
              className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/65"
            >
              {q}
            </span>
          ))}
          {!usingCustom && allQueries.length > queries.length && (
            <span className="text-[10px] text-white/40">
              +{allQueries.length - queries.length} more
            </span>
          )}
        </div>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            placeholder="Or type your own query (e.g. 'TNT Sports 2', 'BeIN')"
            value={customQuery ?? ""}
            onChange={(e) => setCustomQuery(e.target.value || null)}
            className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-10 pr-3 text-sm text-white placeholder:text-white/40 focus:border-cyan-300/40 focus:outline-none"
          />
        </div>

        {anyLoading && hits.length === 0 && (
          <div className="flex items-center gap-2 py-6 text-sm text-white/50">
            <Loader2 className="size-4 animate-spin" />
            Searching engine catalog…
          </div>
        )}

        {!anyLoading && hits.length === 0 && completed > 0 && (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-white/50">
            <p className="mb-2">
              No channels in the engine catalog match this match yet.
            </p>
            <p className="text-xs text-white/40">
              Try a broader query above (e.g. the network name), or paste a
              specific 40-char ID into the form at the top of the page.
            </p>
          </div>
        )}

        {hits.length > 0 && (
          <div className="max-h-[55vh] space-y-1.5 overflow-y-auto pr-1">
            {hits.map((hit) => (
              <div key={hit.content_id} className="space-y-1">
                <SearchHitRow
                  hit={hit}
                  disabled={submitting}
                  onPlay={() => onPick(hit)}
                />
                {!usingCustom && hit.matchedQueries.length > 0 && (
                  <div className="ml-12 flex flex-wrap gap-1 text-[10px] text-white/35">
                    {hit.matchedQueries.slice(0, 3).map((mq) => (
                      <span
                        key={mq}
                        className="rounded-full bg-white/5 px-1.5 py-0.5"
                      >
                        matched "{mq}"
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-white/40">
          Channels come from the live Acestream engine catalog. Availability
          and bitrate are reported by peers — pick the one with the highest
          numbers for the smoothest stream.
        </p>
      </div>
    </div>
  );
}

function SearchHitRow({
  hit,
  onPlay,
  disabled,
}: {
  hit: AcestreamSearchHit;
  onPlay: () => void;
  disabled: boolean;
}) {
  const availability = hit.availability ?? 0;
  const dot =
    availability >= 1
      ? "bg-emerald-400"
      : availability >= 0.5
        ? "bg-amber-400"
        : "bg-red-400/70";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/3 p-2.5 hover:border-cyan-300/30 hover:bg-white/6">
      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-cyan-300/10">
        {hit.icon ? (
          <img
            src={hit.icon}
            alt=""
            className="size-9 object-contain"
            loading="lazy"
          />
        ) : (
          <Globe className="size-4 text-cyan-200" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />
          <span className="truncate text-sm font-medium text-white">
            {hit.name}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/45">
          {hit.now_playing && (
            <span className="truncate text-cyan-200/80">
              ▶ {hit.now_playing}
            </span>
          )}
          {hit.bitrate && (
            <span>{Math.round(hit.bitrate / 1000)} kbps</span>
          )}
          {hit.countries.length > 0 && (
            <span>{hit.countries.join(", ").toUpperCase()}</span>
          )}
          {hit.languages.length > 0 && (
            <span>{hit.languages.join(", ")}</span>
          )}
        </div>
      </div>
      <button
        onClick={onPlay}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-full bg-cyan-300/20 px-3 py-1 text-xs font-medium text-cyan-100 hover:bg-cyan-300/30 disabled:opacity-50"
      >
        <Play className="size-3" fill="currentColor" />
        Play
      </button>
    </div>
  );
}

function ChannelBrowser({
  onPlay,
  playing,
}: {
  onPlay: (hit: AcestreamSearchHit) => void;
  playing: boolean;
}) {
  const QUICK_QUERIES = [
    "sport",
    "football",
    "premier",
    "champions",
    "nba",
    "nfl",
    "f1",
    "tennis",
    "ufc",
    "news",
    "movies",
  ];
  const [query, setQuery] = useState("sport");
  const [submitted, setSubmitted] = useState("sport");

  const search = useQuery({
    queryKey: ["acestream", "search", "browse", submitted],
    queryFn: () => api.acestreamSearch(submitted),
    enabled: submitted.trim().length > 0,
    staleTime: 60_000,
  });

  const hits = search.data ?? [];

  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
      <div>
        <h2 className="text-base font-medium">Browse channels</h2>
        <p className="text-xs text-white/50">
          Search the engine catalog directly — no IDs, no copy-paste, just
          click play.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query.trim() || "sport");
        }}
        className="relative"
      >
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Sky Sports, BeIN, ESPN, NBA, F1…"
          className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-10 pr-24 text-sm text-white placeholder:text-white/40 focus:border-cyan-300/40 focus:outline-none"
        />
        <button
          type="submit"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-cyan-300/20 px-3 py-1 text-xs font-medium text-cyan-100 hover:bg-cyan-300/30"
        >
          Search
        </button>
      </form>

      <div className="-mx-1 flex flex-wrap gap-1">
        {QUICK_QUERIES.map((q) => (
          <button
            key={q}
            onClick={() => {
              setQuery(q);
              setSubmitted(q);
            }}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition-colors",
              submitted === q
                ? "bg-cyan-300/20 text-cyan-100"
                : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white",
            )}
          >
            {q}
          </button>
        ))}
      </div>

      {search.isLoading && (
        <div className="flex items-center gap-2 py-4 text-sm text-white/50">
          <Loader2 className="size-4 animate-spin" />
          Searching…
        </div>
      )}

      {!search.isLoading && hits.length === 0 && submitted && (
        <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-white/50">
          No channels matched "{submitted}". Try a different query above.
        </div>
      )}

      {hits.length > 0 && (
        <div className="space-y-1.5">
          {hits.slice(0, 30).map((hit) => (
            <SearchHitRow
              key={hit.content_id}
              hit={hit}
              disabled={playing}
              onPlay={() => onPlay(hit)}
            />
          ))}
          {hits.length > 30 && (
            <div className="pt-1 text-center text-xs text-white/40">
              Showing first 30 of {hits.length} — refine your search.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
