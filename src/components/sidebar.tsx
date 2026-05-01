import { NavLink, useLocation } from "react-router-dom";
import { Home, Compass, Star, Settings, Radio, Film, MonitorPlay, Bookmark, Zap, RadioTower } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";
import type { ChannelRow } from "@/types";

type SidebarLink = {
  to: string;
  label: string;
  icon: typeof Home;
  // When true, only treat the link as active on the exact pathname (no
  // prefix matches). Otherwise we also match a custom predicate so e.g.
  // "Movies" highlights for /movies, /movies/:id, AND /browse/movie.
  exact?: boolean;
  match?: (pathname: string) => boolean;
};

const links: SidebarLink[] = [
  { to: "/", label: "Home", icon: Home, exact: true },
  // Live TV's path /browse collides as a prefix with /browse/movie and
  // /browse/tv (the All-Movies/All-Series infinite-scroll pages), so it
  // must be exact-match only.
  {
    to: "/browse",
    label: "Live TV",
    icon: Compass,
    exact: true,
    match: (p) => p === "/browse" || p.startsWith("/browse?"),
  },
  { to: "/acestream", label: "Live sports", icon: Zap },
  {
    to: "/movies",
    label: "Movies",
    icon: Film,
    match: (p) => p.startsWith("/movies") || p === "/browse/movie",
  },
  {
    to: "/series",
    label: "Series",
    icon: MonitorPlay,
    match: (p) => p.startsWith("/series") || p === "/browse/tv",
  },
  { to: "/radio", label: "Radio", icon: RadioTower },
  { to: "/watchlist", label: "Watchlist", icon: Bookmark },
  { to: "/favorites", label: "Favorites", icon: Star },
  { to: "/settings", label: "Settings", icon: Settings },
];

function hashHue(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function Sidebar({ width }: { width: number }) {
  const recents = useAppStore((s) => s.recents);
  const current = useAppStore((s) => s.current);
  const setCurrent = useAppStore((s) => s.setCurrent);
  const location = useLocation();

  return (
    <aside
      className="flex h-full shrink-0 flex-col gap-4 border-r border-white/10 bg-white/5 p-4 backdrop-blur-2xl"
      style={{ width }}
    >
      <div className="flex items-center gap-2 px-1">
        <img
          src="/icon.png"
          alt="Oono"
          className="size-9 rounded-xl object-contain"
        />
        <div>
          <div className="text-lg font-semibold">Oono Ent</div>
          <div className="text-xs text-white/50">Free entertainment</div>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {links.map((l) => {
          // Compute active state ourselves so we can support cross-route
          // highlighting (e.g. "Movies" lights up for /browse/movie).
          const active = l.match
            ? l.match(location.pathname)
            : l.exact
              ? location.pathname === l.to
              : location.pathname.startsWith(l.to);
          return (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.exact}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-cyan-300/15 text-cyan-100"
                  : "text-white/70 hover:bg-white/10 hover:text-white",
              )}
            >
              <l.icon className="size-4" />
              {l.label}
            </NavLink>
          );
        })}
      </nav>

      {recents.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-2 px-2 text-xs font-medium text-white/50">
            Recently watched
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
            {recents.map((c) => (
              <RecentRow
                key={c.url}
                channel={c}
                active={current?.url === c.url}
                onClick={() => setCurrent(c)}
              />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function RecentRow({
  channel,
  active,
  onClick,
}: {
  channel: ChannelRow;
  active?: boolean;
  onClick: () => void;
}) {
  const display = channel.name ?? channel.channel;
  const hue = hashHue(display);
  const initial = display.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "TV";
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
        active ? "bg-cyan-300/15" : "hover:bg-white/10",
      )}
    >
      <div
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-[9px] font-semibold text-white/90"
        style={{
          background: `linear-gradient(135deg, oklch(0.55 0.13 ${hue}) 0%, oklch(0.40 0.14 ${(hue + 40) % 360}) 100%)`,
        }}
      >
        {initial}
      </div>
      <span className="min-w-0 flex-1 truncate text-xs text-white/80">
        {display}
      </span>
      {active && <Radio className="size-3 shrink-0 text-emerald-300" />}
    </button>
  );
}
