/** @type {import("next").NextConfig} */
const config = {
  // better-sqlite3 is a native module; it must not be bundled into the server build.
  serverExternalPackages: ["better-sqlite3"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "upload.wikimedia.org" }],
  },
};

export default config;
