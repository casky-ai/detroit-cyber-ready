import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Workspace packages export raw TypeScript, so Next transpiles them in place.
  // No build step, no dist directory, no stale-artifact class of bug.
  transpilePackages: ["@dcr/signals", "@dcr/impact", "@dcr/investigate"],
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  // @dcr/impact/data reads data/detroit/*.yaml, and @dcr/investigate/skills
  // reads upstream/skills/index.json, both via a runtime fs.readFile at a
  // path computed from import.meta.url. Next's file tracer only bundles
  // files it can see through static import statements, so without this,
  // every deployed function that touches the Detroit inventory or the
  // skills corpus 404s on ENOENT in production while working perfectly in
  // `next dev`, where the full monorepo is just sitting on disk. Found by
  // running the actual deployed demo endpoint, not by any test — vitest
  // runs against the real filesystem too, so this class of bug is
  // invisible to the whole test suite by construction.
  outputFileTracingIncludes: {
    "/api/**/*": ["../../data/detroit/**/*", "../../upstream/skills/index.json"],
  },
};

export default nextConfig;
