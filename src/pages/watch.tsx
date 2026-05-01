import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { useAppStore } from "@/store";

export function WatchPage() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const [params] = useSearchParams();
  const setVodPlaying = useAppStore((s) => s.setVodPlaying);
  const vodPlaying = useAppStore((s) => s.vodPlaying);

  const tmdbId = Number(id);
  const k = (kind === "tv" ? "tv" : "movie") as "movie" | "tv";
  const season = params.get("s") ? Number(params.get("s")) : null;
  const episode = params.get("e") ? Number(params.get("e")) : null;

  const detail = useQuery({
    queryKey: ["vod", "detail", k, tmdbId],
    queryFn: () => api.vodDetail(k, tmdbId),
    enabled: Number.isFinite(tmdbId),
  });

  useEffect(() => {
    if (!detail.data) return;
    const targetMediaId = `${k}:${tmdbId}`;
    const sameTarget =
      vodPlaying?.mediaId === targetMediaId &&
      vodPlaying?.season === season &&
      vodPlaying?.episode === episode;
    if (sameTarget) return;
    setVodPlaying({
      mediaId: targetMediaId,
      kind: k,
      tmdbId,
      season,
      episode,
      provider: vodPlaying?.provider ?? "vidsrc",
      title: detail.data.title,
      posterPath: detail.data.poster_path,
      runtimeMin: detail.data.runtime,
    });
  }, [detail.data, season, episode]);

  return null;
}
