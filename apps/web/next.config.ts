import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Workspace packages export raw TypeScript, so Next transpiles them in place.
  // No build step, no dist directory, no stale-artifact class of bug.
  transpilePackages: ["@dcr/signals", "@dcr/impact", "@dcr/investigate"],
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
};

export default nextConfig;
