import { defineConfig } from "wxt";

import { buildManifest, toTargetBrowser } from "./lib/manifest";

/** Workspace files AMO reviewers need to rebuild the Firefox package from source. */
const SOURCE_FILES = [
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "tsconfig.base.json",
  "patches/**",
  "apps/alcove-extension/*.{json,ts,mjs,md}",
  "apps/alcove-extension/.gitignore",
  "apps/alcove-extension/{entrypoints,lib,public,assets}/**",
  "apps/alcove-extension/store/SOURCE-BUILD.md",
  "packages/alcove-shared/**",
  "packages/analytics/**",
  "packages/auth-sdk/**",
  "packages/db-client/**",
  "packages/hicya-signature/**",
  "packages/splotch/**",
  "packages/ui/**",
  "packages/sync/**",
  "packages/eslint-config/**",
  "packages/tsconfig/**",
];

export default defineConfig({
  srcDir: ".",
  entrypointsDir: "entrypoints",
  manifestVersion: 3,
  manifest: ({ browser }) => buildManifest(toTargetBrowser(browser)),
  zip: {
    name: "alcove-extension",
    // The sources zip (Firefox only) is rooted at the monorepo so workspace packages and the
    // lockfile are included. Everything else in the monorepo is excluded.
    sourcesRoot: "../..",
    includeSources: SOURCE_FILES,
    excludeSources: ["**"],
  },
});
