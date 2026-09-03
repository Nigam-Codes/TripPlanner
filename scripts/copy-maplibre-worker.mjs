// maplibre resolves its worker as "./maplibre-gl-worker.mjs" relative to
// import.meta.url. Once Next bundles the library that sibling file no longer
// exists, so the request falls through to the HTML 404 page and the browser
// rejects it for having a "text/html" MIME type. The map then renders its DOM
// markers but never loads a single tile.
//
// Copying the worker into public/ gives setWorkerUrl() a real path to point at.
// The worker itself imports "./maplibre-gl-shared.mjs", so that sibling has to
// come along or the worker fails the same way one level deeper.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
const publicDir = join(process.cwd(), "public");

mkdirSync(publicDir, { recursive: true });

for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(dist, file), join(publicDir, file));
  console.log(`copied ${file} -> public/`);
}
