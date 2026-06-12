// TraySync — mirrors the in-app player state to the system tray icon and
// reacts to tray-menu clicks. Mounted once at the App root.
//
// What we push UP to the tray:
//   - Now-playing title + subtitle (from current channel / vodPlaying /
//     radioCurrent — whichever is most recent).
//   - Whether content is currently playing (radio is binary; live TV
//     defaults to true while a channel is set; VOD is in an iframe so we
//     can't observe it precisely — we treat it as "playing" while open).
//   - Whether a "Next episode" action makes sense.
//   - Engine phase (running / starting / stopped / error / unresponsive).
//
// What we listen to FROM the tray (via Tauri event "tray-action"):
//   - "play_pause" → pause the active media if we can; for VOD we toggle
//     the persistent player's minimized state (no API into the iframe).
//   - "stop"       → clear current/vodPlaying/radioCurrent.
//   - "next"       → advance to the next episode for series.
//
// Engine controls (start/stop/restart) are handled entirely on the Rust
// side — they call the same VM-host helpers as the in-app buttons, so no
// frontend round-trip is needed.

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api } from "@/api";
import { useAppStore } from "@/store";
import type { EnginePhase } from "@/types";

// The system tray only exists in the Tauri desktop build. In the iPad
// WKWebView build there's no tray, no IPC, and calling `invoke` /
// `listen` would just spam errors — bail out early.
const HAS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type TrayState = {
  now_playing_title: string | null;
  now_playing_subtitle: string | null;
  kind: string | null;
  is_playing: boolean;
  can_next: boolean;
  engine_state: string | null;
};

function enginePhaseToTray(
  phase: EnginePhase | undefined,
  installed: boolean | undefined,
): string | null {
  if (!phase) return null;
  switch (phase.kind) {
    case "running":
      return installed ? "running" : "unresponsive";
    case "starting":
      return "starting";
    case "stopping":
    case "stopped":
    case "not_provisioned":
      return "stopped";
    case "error":
      return "error";
    case "provisioning":
      return "starting";
    default:
      return null;
  }
}

export function TraySync() {
  const current = useAppStore((s) => s.current);
  const setCurrent = useAppStore((s) => s.setCurrent);
  const vodPlaying = useAppStore((s) => s.vodPlaying);
  const setVodPlaying = useAppStore((s) => s.setVodPlaying);
  const radioCurrent = useAppStore((s) => s.radioCurrent);
  const setRadioCurrent = useAppStore((s) => s.setRadioCurrent);
  const radioMuted = useAppStore((s) => s.radioMuted);
  const setRadioMuted = useAppStore((s) => s.setRadioMuted);

  const runtime = useQuery({
    queryKey: ["engine", "runtime"],
    queryFn: api.engineRuntimeStatus,
    refetchInterval: 5_000,
    enabled: HAS_TAURI,
  });
  const ace = useQuery({
    queryKey: ["acestream", "status"],
    queryFn: api.acestreamStatus,
    refetchInterval: 30_000,
    enabled: HAS_TAURI,
  });

  // Push state to the tray whenever anything user-visible changes. We
  // pick the "primary" media in priority order: live TV > VOD > radio,
  // matching what the player UI shows on screen.
  useEffect(() => {
    if (!HAS_TAURI) return;
    let title: string | null = null;
    let subtitle: string | null = null;
    let kind: string | null = null;
    let isPlaying = false;
    let canNext = false;

    if (current) {
      title = current.name ?? current.channel;
      kind = current.source_id === "acestream" ? "acestream" : "live";
      isPlaying = true;
    } else if (vodPlaying) {
      title = vodPlaying.title;
      if (vodPlaying.kind === "tv" && vodPlaying.season !== null && vodPlaying.episode !== null) {
        subtitle = `S${vodPlaying.season} · E${vodPlaying.episode}`;
        canNext = true;
      }
      kind = "vod";
      isPlaying = true;
    } else if (radioCurrent) {
      title = radioCurrent.name;
      subtitle = radioCurrent.country ?? null;
      kind = "radio";
      isPlaying = !radioMuted;
    }

    const state: TrayState = {
      now_playing_title: title,
      now_playing_subtitle: subtitle,
      kind,
      is_playing: isPlaying,
      can_next: canNext,
      engine_state: enginePhaseToTray(
        runtime.data?.state.phase,
        ace.data?.installed,
      ),
    };

    invoke("cmd_tray_update", { state }).catch((e) =>
      console.warn("[tray] update failed", e),
    );
  }, [
    current?.channel,
    current?.name,
    current?.source_id,
    vodPlaying?.mediaId,
    vodPlaying?.season,
    vodPlaying?.episode,
    vodPlaying?.title,
    radioCurrent?.uuid,
    radioCurrent?.name,
    radioMuted,
    runtime.data?.state.phase.kind,
    ace.data?.installed,
  ]);

  // Tray menu click handler: actions the Rust side forwards back to us.
  useEffect(() => {
    if (!HAS_TAURI) return;
    let unlisten: (() => void) | null = null;
    listen<string>("tray-action", (e) => {
      const action = e.payload;
      switch (action) {
        case "play_pause": {
          // For radio we have a real mute toggle. For live TV / VOD we
          // can't programmatically pause the underlying media element /
          // iframe from here, so toggle visibility instead — which has
          // the same UX outcome (the user expects "click play/pause to
          // toggle without opening the app").
          if (radioCurrent) {
            setRadioMuted(!radioMuted);
          } else if (current) {
            // Live TV: clearing current pauses playback effectively.
            // (Better UX would be a real pause API; we don't have one
            // exposed from the Player ref to here.)
            setCurrent(null);
          } else if (vodPlaying) {
            setVodPlaying(null);
          }
          break;
        }
        case "stop": {
          if (current) setCurrent(null);
          if (vodPlaying) setVodPlaying(null);
          if (radioCurrent) setRadioCurrent(null);
          break;
        }
        case "next": {
          // Advance to the next episode for the active TV show.
          if (
            vodPlaying &&
            vodPlaying.kind === "tv" &&
            vodPlaying.season !== null &&
            vodPlaying.episode !== null
          ) {
            setVodPlaying({
              ...vodPlaying,
              episode: vodPlaying.episode + 1,
            });
          }
          break;
        }
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [
    current,
    vodPlaying,
    radioCurrent,
    radioMuted,
    setCurrent,
    setVodPlaying,
    setRadioCurrent,
    setRadioMuted,
  ]);

  return null;
}
