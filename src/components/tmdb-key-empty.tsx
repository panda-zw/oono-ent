import { Link } from "react-router-dom";
import { KeyRound, ExternalLink } from "lucide-react";

export function TmdbKeyEmpty() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="glass max-w-md space-y-3 rounded-2xl p-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-cyan-300/15 text-cyan-200">
          <KeyRound className="size-5" />
        </div>
        <h2 className="text-lg font-semibold">Add a TMDb API key to continue</h2>
        <p className="text-sm text-white/60">
          Movies and series are powered by The Movie Database. The API is free for personal use — paste a key in Settings and you're set.
        </p>
        <div className="flex flex-col gap-2">
          <Link
            to="/settings"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-300/20 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-300/30"
          >
            Open Settings
          </Link>
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 text-xs text-white/60 hover:text-white/90"
          >
            Get a TMDb key
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
