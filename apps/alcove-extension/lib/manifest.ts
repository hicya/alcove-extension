/**
 * Manifest generation per target browser.
 *
 * Kept free of WXT imports so it can be unit tested. `wxt.config.ts` calls
 * `buildManifest(browser)` and WXT merges the result with the entrypoint-derived
 * fields (background, options_ui, web_accessible_resources).
 */

export const AUTH_HOST = "https://auth.hicya.org";
export const SYNC_HOST = "https://sync.hicya.org";

/** Fixed add-on ID for Firefox. The identity redirect host is derived from it. */
export const GECKO_ID = "alcove@hicya.org";

/** First Firefox release with built-in data collection consent (desktop). */
export const GECKO_MIN_VERSION = "140.0";

/** Store version. Bump for every store upload. */
export const EXTENSION_VERSION = "1.0.0";

export const SAVE_SHORTCUT = "Alt+Shift+S";

const ICONS = {
  "16": "assets/icon-16.png",
  "32": "assets/icon-32.png",
  "48": "assets/icon-48.png",
  "128": "assets/icon-128.png",
};

export type TargetBrowser = "chrome" | "edge" | "firefox";

export interface GeckoSettings {
  id: string;
  strict_min_version: string;
  data_collection_permissions: {
    required: string[];
    optional?: string[];
  };
}

export interface AlcoveManifest {
  version: string;
  name: string;
  short_name: string;
  description: string;
  homepage_url: string;
  permissions: string[];
  host_permissions: string[];
  icons: Record<string, string>;
  action: {
    default_title: string;
    default_icon: Record<string, string>;
  };
  commands: Record<string, { suggested_key: { default: string }; description: string }>;
  browser_specific_settings?: { gecko: GeckoSettings };
}

export function toTargetBrowser(browser: string): TargetBrowser {
  if (browser === "firefox" || browser === "edge") return browser;
  return "chrome";
}

export function buildManifest(browser: TargetBrowser): AlcoveManifest {
  const manifest: AlcoveManifest = {
    version: EXTENSION_VERSION,
    name: "Alcove by hicya",
    short_name: "Alcove",
    description:
      "Read it later. Free, no ads. Save articles to Alcove in one click and read them distraction-free on any device.",
    homepage_url: "https://alcove.hicya.org",
    // activeTab + scripting: read the page only when the user asks (toolbar, menu, shortcut).
    // identity: sign in through auth.hicya.org with launchWebAuthFlow.
    permissions: ["activeTab", "scripting", "storage", "contextMenus", "identity"],
    // Only Alcove's own services. Their CORS policy does not list extension origins, so the
    // background script needs host access to read their responses.
    host_permissions: [`${AUTH_HOST}/*`, `${SYNC_HOST}/*`],
    icons: ICONS,
    action: {
      default_title: "Save to Alcove",
      default_icon: ICONS,
    },
    commands: {
      _execute_action: {
        suggested_key: { default: SAVE_SHORTCUT },
        description: "Save this page to Alcove",
      },
    },
  };

  if (browser === "firefox") {
    manifest.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        strict_min_version: GECKO_MIN_VERSION,
        data_collection_permissions: {
          // Saved pages (URL and article text) go to the user's Alcove account, and the
          // extension signs in to auth.hicya.org. Nothing else leaves the browser.
          required: ["websiteContent", "browsingActivity", "authenticationInfo"],
        },
      },
    };
  }

  return manifest;
}
