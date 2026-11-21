/** Context menu definitions and click → save request mapping. */

import type { SaveRequest } from "./save";

export const MENU_SAVE_PAGE = "alcove-save-page";
export const MENU_SAVE_LINK = "alcove-save-link";

/** Menus only appear on regular web pages and for web links. */
export const WEB_URL_PATTERNS = ["http://*/*", "https://*/*"];

export interface MenuDefinition {
  id: string;
  title: string;
  contexts: ["page"] | ["link"];
  documentUrlPatterns: string[];
  targetUrlPatterns?: string[];
}

export const MENU_DEFINITIONS: MenuDefinition[] = [
  {
    id: MENU_SAVE_PAGE,
    title: "Save page to Alcove",
    contexts: ["page"],
    documentUrlPatterns: WEB_URL_PATTERNS,
  },
  {
    id: MENU_SAVE_LINK,
    title: "Save link to Alcove",
    contexts: ["link"],
    documentUrlPatterns: WEB_URL_PATTERNS,
    targetUrlPatterns: WEB_URL_PATTERNS,
  },
];

/** Recreate the menus. Safe to call on every install, update and browser start. */
export async function registerContextMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();
  for (const menu of MENU_DEFINITIONS) {
    chrome.contextMenus.create(menu, () => {
      // Reading lastError marks it handled (a duplicate id after a race is harmless).
      void chrome.runtime.lastError;
    });
  }
}

export interface MenuClick {
  menuItemId: string | number;
  linkUrl?: string;
  linkText?: string;
  pageUrl?: string;
}

export interface MenuTab {
  id?: number;
  url?: string;
  title?: string;
}

export function requestFromMenuClick(
  info: MenuClick,
  tab: MenuTab | undefined,
): SaveRequest | null {
  const tabId = tab?.id;
  if (tabId === undefined || tabId < 0) return null;

  if (info.menuItemId === MENU_SAVE_LINK && info.linkUrl) {
    return { kind: "link", tabId, linkUrl: info.linkUrl, linkText: info.linkText };
  }
  if (info.menuItemId === MENU_SAVE_PAGE) {
    return { kind: "page", tabId, tabUrl: tab?.url ?? info.pageUrl, tabTitle: tab?.title };
  }
  return null;
}
