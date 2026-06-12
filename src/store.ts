import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChannelRow, RadioStation, VodPlaying } from "./types";

const RECENTS_LIMIT = 8;

type ViewMode = "split" | "theater";
export type QualityPreference = "best" | "smart" | "save";

type AppStore = {
  current: ChannelRow | null;
  setCurrent: (c: ChannelRow | null) => void;
  recents: ChannelRow[];
  pinRecent: (c: ChannelRow) => void;

  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;

  qualityPreference: QualityPreference;
  setQualityPreference: (q: QualityPreference) => void;

  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (b: boolean) => void;
  toggleSidebar: () => void;
  playerWidth: number;
  setPlayerWidth: (w: number) => void;

  vodPlaying: VodPlaying | null;
  setVodPlaying: (v: VodPlaying | null) => void;
  vodMinimized: boolean;
  setVodMinimized: (b: boolean) => void;
  vodAutoplay: boolean;
  setVodAutoplay: (b: boolean) => void;

  radioCurrent: RadioStation | null;
  setRadioCurrent: (s: RadioStation | null) => void;
  radioVolume: number;
  setRadioVolume: (v: number) => void;
  radioMuted: boolean;
  setRadioMuted: (m: boolean) => void;
};

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      current: null,
      setCurrent: (current) => {
        set({ current });
        if (current) {
          set((s) => {
            const next = [
              current,
              ...s.recents.filter((r) => r.url !== current.url),
            ].slice(0, RECENTS_LIMIT);
            return { recents: next };
          });
        }
      },
      recents: [],
      pinRecent: (c) =>
        set((s) => ({
          recents: [c, ...s.recents.filter((r) => r.url !== c.url)].slice(
            0,
            RECENTS_LIMIT,
          ),
        })),

      viewMode: "split",
      setViewMode: (viewMode) => set({ viewMode }),

      qualityPreference: "smart",
      setQualityPreference: (qualityPreference) => set({ qualityPreference }),

      sidebarWidth: 240,
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      sidebarCollapsed: false,
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      playerWidth: 640,
      setPlayerWidth: (playerWidth) => set({ playerWidth }),

      vodPlaying: null,
      setVodPlaying: (vodPlaying) => set({ vodPlaying, vodMinimized: false }),
      vodMinimized: false,
      setVodMinimized: (vodMinimized) => set({ vodMinimized }),
      vodAutoplay: true,
      setVodAutoplay: (vodAutoplay) => set({ vodAutoplay }),

      radioCurrent: null,
      setRadioCurrent: (radioCurrent) => set({ radioCurrent }),
      radioVolume: 0.85,
      setRadioVolume: (radioVolume) => set({ radioVolume }),
      radioMuted: false,
      setRadioMuted: (radioMuted) => set({ radioMuted }),
    }),
    {
      name: "oono-ent-store",
      partialize: (s) => ({
        recents: s.recents,
        sidebarWidth: s.sidebarWidth,
        sidebarCollapsed: s.sidebarCollapsed,
        playerWidth: s.playerWidth,
        viewMode: s.viewMode,
        qualityPreference: s.qualityPreference,
        vodAutoplay: s.vodAutoplay,
        radioVolume: s.radioVolume,
        radioMuted: s.radioMuted,
      }),
    },
  ),
);
