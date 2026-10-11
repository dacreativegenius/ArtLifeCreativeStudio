/**
 * Build a path for static files under `apps/vite/public/` that works in both:
 * - sandbox preview at `/`
 * - published preview at `/preview/<projectId>/`
 *
 * Usage:
 *   <img src={assetPath("hero.jpg")} />
 *   <video poster={assetPath("posters/intro.png")} />
 */
export function assetPath(file: string): string {
  const clean = file.replace(/^\/+/, "");
  return `${import.meta.env.BASE_URL}${clean}`;
}

