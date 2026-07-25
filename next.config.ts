import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pdf-parse and mammoth are Node-only libs that Next's server bundler chokes on
  // (pdf-parse does a computed require() the bundler can't resolve). Opting them
  // out of bundling keeps them as native Node `require`s instead.
  serverExternalPackages: ["pdf-parse", "mammoth"],
};

export default nextConfig;
