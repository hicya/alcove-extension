import { describe, it, expect } from "vitest";

import { buildManifest, GECKO_ID, toTargetBrowser } from "../manifest";

describe("buildManifest", () => {
  it.each(["chrome", "edge", "firefox"] as const)("keeps %s permissions narrow", (browser) => {
    const manifest = buildManifest(browser);
    expect(manifest.permissions).toEqual([
      "activeTab",
      "scripting",
      "storage",
      "contextMenus",
      "identity",
    ]);
    expect(manifest.host_permissions).toEqual([
      "https://auth.hicya.org/*",
      "https://sync.hicya.org/*",
    ]);
    // Analytics posts to google-analytics.com in no-cors mode, which needs no host access.
    expect(JSON.stringify(manifest)).not.toContain("google-analytics.com");
    expect(JSON.stringify(manifest)).not.toContain("<all_urls>");
    expect(manifest).not.toHaveProperty("content_scripts");
  });

  it("binds the save shortcut to the toolbar action", () => {
    expect(buildManifest("chrome").commands._execute_action.suggested_key.default).toBe(
      "Alt+Shift+S",
    );
  });

  it("uses the store name", () => {
    expect(buildManifest("chrome").name).toBe("Alcove by hicya");
  });

  it("leads the description with the store subtitle within the CWS limit", () => {
    const { description } = buildManifest("chrome");
    expect(description.startsWith("Read it later. Free, no ads. ")).toBe(true);
    expect(description.length).toBeLessThanOrEqual(132);
  });

  it("adds Gecko settings only for Firefox", () => {
    expect(buildManifest("chrome").browser_specific_settings).toBeUndefined();
    expect(buildManifest("edge").browser_specific_settings).toBeUndefined();

    const gecko = buildManifest("firefox").browser_specific_settings?.gecko;
    expect(gecko?.id).toBe(GECKO_ID);
    expect(gecko?.strict_min_version).toBe("140.0");
    expect(gecko?.data_collection_permissions.required).toEqual([
      "websiteContent",
      "browsingActivity",
      "authenticationInfo",
    ]);
  });

  it("maps WXT browser names", () => {
    expect(toTargetBrowser("firefox")).toBe("firefox");
    expect(toTargetBrowser("edge")).toBe("edge");
    expect(toTargetBrowser("chrome")).toBe("chrome");
    expect(toTargetBrowser("opera")).toBe("chrome");
  });
});
