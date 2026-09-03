// GitHub Pages serves a project site from https://<user>.github.io/<repo>/, so every
// asset URL needs that prefix. Kept in an env var so `npm run dev` still works at the
// root without it.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** @type {import("next").NextConfig} */
const config = {
  output: "export",
  // Emits /plan/index.html rather than /plan.html, which is what a static host needs
  // in order to serve /plan/ without a rewrite rule.
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  // next/image needs a server to optimise; a static export has none.
  images: { unoptimized: true },
};

export default config;
