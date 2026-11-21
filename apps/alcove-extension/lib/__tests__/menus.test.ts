import { afterEach, describe, it, expect, vi } from "vitest";

import {
  MENU_DEFINITIONS,
  MENU_SAVE_LINK,
  MENU_SAVE_PAGE,
  registerContextMenus,
  requestFromMenuClick,
} from "../menus";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MENU_DEFINITIONS", () => {
  it("offers page and link saves on web pages only", () => {
    expect(MENU_DEFINITIONS.map((menu) => [menu.id, menu.title, menu.contexts[0]])).toEqual([
      [MENU_SAVE_PAGE, "Save page to Alcove", "page"],
      [MENU_SAVE_LINK, "Save link to Alcove", "link"],
    ]);
    for (const menu of MENU_DEFINITIONS) {
      expect(menu.documentUrlPatterns).toEqual(["http://*/*", "https://*/*"]);
    }
    expect(MENU_DEFINITIONS[1].targetUrlPatterns).toEqual(["http://*/*", "https://*/*"]);
  });
});

describe("registerContextMenus", () => {
  it("clears old menus before creating them again", async () => {
    const calls: string[] = [];
    vi.stubGlobal("chrome", {
      runtime: { lastError: undefined },
      contextMenus: {
        removeAll: vi.fn(() => {
          calls.push("removeAll");
          return Promise.resolve();
        }),
        create: vi.fn((menu: { id: string }, callback: () => void) => {
          calls.push(`create:${menu.id}`);
          callback();
        }),
      },
    });

    await registerContextMenus();
    expect(calls).toEqual(["removeAll", `create:${MENU_SAVE_PAGE}`, `create:${MENU_SAVE_LINK}`]);
  });
});

describe("requestFromMenuClick", () => {
  const tab = { id: 4, url: "https://example.org/list", title: "Reading list" };

  it("turns a link click into a link save in the clicked tab", () => {
    expect(
      requestFromMenuClick(
        { menuItemId: MENU_SAVE_LINK, linkUrl: "https://example.org/essay", linkText: "Essay" },
        tab,
      ),
    ).toEqual({ kind: "link", tabId: 4, linkUrl: "https://example.org/essay", linkText: "Essay" });
  });

  it("turns a page click into a page save", () => {
    expect(requestFromMenuClick({ menuItemId: MENU_SAVE_PAGE }, tab)).toEqual({
      kind: "page",
      tabId: 4,
      tabUrl: "https://example.org/list",
      tabTitle: "Reading list",
    });
  });

  it("falls back to the click's page URL", () => {
    expect(
      requestFromMenuClick(
        { menuItemId: MENU_SAVE_PAGE, pageUrl: "https://example.org/p" },
        {
          id: 4,
        },
      ),
    ).toMatchObject({ tabUrl: "https://example.org/p" });
  });

  it("ignores clicks without a usable tab or link", () => {
    expect(requestFromMenuClick({ menuItemId: MENU_SAVE_PAGE }, undefined)).toBeNull();
    expect(requestFromMenuClick({ menuItemId: MENU_SAVE_PAGE }, { id: -1 })).toBeNull();
    expect(requestFromMenuClick({ menuItemId: MENU_SAVE_LINK }, tab)).toBeNull();
    expect(requestFromMenuClick({ menuItemId: "other" }, tab)).toBeNull();
  });
});
