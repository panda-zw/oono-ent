export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export function tmdbImage(
  path: string | null,
  size:
    | "w92"
    | "w154"
    | "w185"
    | "w342"
    | "w500"
    | "w780"
    | "original" = "w342",
): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path.startsWith("/") ? path : `/${path}`}`;
}
