import { Star, Radio, Tv } from "lucide-react";
import type { ChannelRow } from "@/types";
import { cn } from "@/lib/utils";

function hashHue(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

function initials(display: string) {
  const cleaned = display.replace(/[^A-Za-z0-9 ]/g, " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase() || "TV";
}

export function ChannelCard({
  channel,
  active,
  onClick,
  onToggleFavorite,
}: {
  channel: ChannelRow;
  active?: boolean;
  onClick?: () => void;
  onToggleFavorite?: () => void;
}) {
  const display = channel.name ?? channel.channel;
  const isGeoBlocked = channel.label?.toLowerCase().includes("geo");
  const isLive = !channel.label || channel.label === "Live";
  const hue = hashHue(display);
  const country = channel.country;
  const topCategory = channel.categories[0];

  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-colors",
        active
          ? "border-cyan-300/40 bg-cyan-300/10"
          : "border-transparent bg-white/3 hover:border-white/15 hover:bg-white/10",
      )}
    >
      <div className="relative size-9 shrink-0">
        {channel.logo ? (
          <img
            src={channel.logo}
            alt=""
            className="size-9 rounded-lg bg-white object-contain p-0.5"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div
            className="flex size-9 items-center justify-center rounded-lg text-[11px] font-semibold text-white/90"
            style={{
              background: `linear-gradient(135deg, oklch(0.55 0.13 ${hue}) 0%, oklch(0.40 0.14 ${(hue + 40) % 360}) 100%)`,
            }}
          >
            {initials(display)}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {isLive ? (
            <Radio className="size-3 shrink-0 text-emerald-300" />
          ) : (
            <Tv className="size-3 shrink-0 text-white/40" />
          )}
          <span className="truncate text-sm font-medium text-white">
            {display}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/50">
          <span>{channel.quality ?? "auto"}</span>
          {country && (
            <>
              <span className="text-white/20">·</span>
              <span>{country}</span>
            </>
          )}
          {topCategory && (
            <>
              <span className="text-white/20">·</span>
              <span className="capitalize">{topCategory}</span>
            </>
          )}
          {isGeoBlocked && (
            <>
              <span className="text-white/20">·</span>
              <span className="text-amber-300">Region-locked</span>
            </>
          )}
        </div>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite?.();
        }}
        className={cn(
          "shrink-0 rounded-md p-1.5 transition-colors",
          channel.favorite
            ? "text-amber-300 opacity-100"
            : "text-white/30 opacity-0 hover:bg-white/10 hover:text-amber-300 group-hover:opacity-100",
        )}
        aria-label="Toggle favorite"
      >
        <Star
          className="size-3.5"
          fill={channel.favorite ? "currentColor" : "none"}
        />
      </button>
    </button>
  );
}
