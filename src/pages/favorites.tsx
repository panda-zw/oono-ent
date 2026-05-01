import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { ChannelCard } from "@/components/channel-card";
import { useAppStore } from "@/store";

export function FavoritesPage() {
  const setCurrent = useAppStore((s) => s.setCurrent);
  const current = useAppStore((s) => s.current);
  const qc = useQueryClient();

  const { data: channels = [] } = useQuery({
    queryKey: ["channels", "favorites"],
    queryFn: () => api.listChannels({ favorites_only: true, limit: 500 }),
  });

  const setFav = useMutation({
    mutationFn: ({ channel, fav }: { channel: string; fav: boolean }) =>
      api.setFavorite(channel, fav),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["favorites"] });
    },
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl">
      <div className="border-b border-white/5 px-4 py-3">
        <h2 className="text-base font-semibold text-white">Favorites</h2>
        <p className="text-xs text-white/50">Channels you've starred</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {channels.map((c) => (
          <ChannelCard
            key={`${c.channel}-${c.url}`}
            channel={c}
            active={current?.url === c.url}
            onClick={() => setCurrent(c)}
            onToggleFavorite={() =>
              setFav.mutate({ channel: c.channel, fav: !c.favorite })
            }
          />
        ))}
        {channels.length === 0 && (
          <div className="m-2 rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-white/50">
            Star channels from Browse to pin them here.
          </div>
        )}
      </div>
    </div>
  );
}
