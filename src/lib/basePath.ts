/**
 * Deployment prefix, injected at build time.
 *
 * Anything that builds a URL by hand — the maplibre worker, share links — has to
 * include this, or it will 404 under a GitHub Pages project site.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}
