/**
 * Background script (service worker on Chrome/Edge, event page on Firefox).
 *
 * Saves start only from a user action, each of which grants temporary activeTab access:
 * - toolbar button, or the Alt+Shift+S shortcut (`_execute_action`) → save the page
 * - context menu "Save page to Alcove" / "Save link to Alcove"
 */

import { newClientId } from "@hicya/analytics/measurement-protocol";

import {
  createExtensionAnalytics,
  resolveAnalyticsConfig,
  trackSaveOutcome,
} from "../lib/analytics";
import { getAccessToken, getAccountId, getEmail, isLoggedIn, login, logout } from "../lib/auth";
import { captureTab, parseHtmlInTab, showToast } from "../lib/inject";
import { registerContextMenus, requestFromMenuClick } from "../lib/menus";
import { isBackgroundMessage } from "../lib/messaging";
import { fetchViaProxy } from "../lib/proxy";
import { badgeForOutcome, performSave, PROGRESS_TOAST, toastForOutcome } from "../lib/save";
import { chromeInboxPins } from "../lib/inbox";
import { pushSealedArticle } from "../lib/sync-push";

import type { AuthStateResponse } from "../lib/messaging";
import type { SaveRequest } from "../lib/save";

// Off unless a release build sets the Measurement Protocol secret; always off on Firefox.
const browserName: unknown = import.meta.env.BROWSER;
const measurementId: unknown = import.meta.env.WXT_GA_MEASUREMENT_ID;
const apiSecret: unknown = import.meta.env.WXT_GA_API_SECRET;
const analytics = createExtensionAnalytics(
  resolveAnalyticsConfig({ browser: browserName, measurementId, apiSecret }),
  {
    local: {
      get: async (key) => (await chrome.storage.local.get(key))[key],
      set: (key, value) => chrome.storage.local.set({ [key]: value }),
    },
    session: {
      get: async (key) => (await chrome.storage.session.get(key))[key],
      set: (key, value) => chrome.storage.session.set({ [key]: value }),
    },
    accountId: getAccountId,
    fetch: (input, init) => fetch(input, init),
    randomId: () => newClientId(),
    now: () => Date.now(),
  },
);

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener((details) => {
    void registerContextMenus();
    // First install: open the options page so the user can sign in before the first save.
    if (details.reason === "install") void chrome.runtime.openOptionsPage();
  });
  chrome.runtime.onStartup.addListener(() => {
    void registerContextMenus();
  });

  chrome.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    void handleSave({ kind: "page", tabId: tab.id, tabUrl: tab.url, tabTitle: tab.title });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    const request = requestFromMenuClick(info, tab);
    if (request) void handleSave(request);
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    // Only the extension's own pages talk to the background script.
    if (sender.id !== chrome.runtime.id || !isBackgroundMessage(message)) return;

    if (message.type === "GET_AUTH_STATE") {
      handleGetAuthState()
        .then(sendResponse)
        .catch(() => sendResponse({ loggedIn: false }));
      return true;
    }
    if (message.type === "LOGIN") {
      const { provider } = message;
      login(provider)
        .then(() => {
          if (provider) void analytics.track("sign_in", { provider });
          sendResponse({ ok: true });
        })
        .catch((err: unknown) => {
          sendResponse({ error: err instanceof Error ? err.message : "Sign-in failed" });
        });
      return true;
    }
    // Signing out also forgets the pinned inbox keys, so signing in again trusts the account's
    // current key (the way out of a "key changed" refusal).
    Promise.all([logout(), chromeInboxPins.clear()])
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: true }));
    return true;
  });
});

// ── Save ───────────────────────────────────────────────────────────────────

async function getTokenOrSignIn(): Promise<string | null> {
  const token = await getAccessToken();
  if (token) return token;
  try {
    await login();
  } catch {
    return null; // Sign-in window closed or failed.
  }
  return getAccessToken();
}

async function handleSave(request: SaveRequest): Promise<void> {
  const { tabId } = request;
  try {
    const outcome = await performSave(request, {
      getToken: getTokenOrSignIn,
      captureTab,
      parseHtmlInTab,
      fetchPage: fetchViaProxy,
      push: (token, article) =>
        pushSealedArticle(token, article, {
          accountId: getAccountId,
          inbox: { pins: chromeInboxPins },
        }),
      onProgress: async () => {
        await setBadge(tabId, "…", "#2D6E73");
        await showToast(tabId, PROGRESS_TOAST);
      },
    });
    void trackSaveOutcome(analytics, outcome);
    const badge = badgeForOutcome(outcome);
    await setBadge(tabId, badge.text, badge.color);
    const toast = toastForOutcome(outcome);
    if (toast) await showToast(tabId, toast);
  } catch (err: unknown) {
    console.error("[alcove] Save failed:", err);
    void analytics.track("save_failed", { source: "extension", reason: "failed" });
    await setBadge(tabId, "!", "#B84A4A");
  }
}

// ── Badge ──────────────────────────────────────────────────────────────────

async function setBadge(tabId: number, text: string, color: string): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text, tabId });
    await chrome.action.setBadgeBackgroundColor({ color, tabId });
  } catch {
    return; // Tab closed.
  }
  if (text === "✓" || text === "!") {
    setTimeout(() => {
      chrome.action.setBadgeText({ text: "", tabId }).catch(() => {
        // Tab closed.
      });
    }, 4000);
  }
}

// ── Options page ───────────────────────────────────────────────────────────

async function handleGetAuthState(): Promise<AuthStateResponse> {
  const loggedIn = await isLoggedIn();
  const email = loggedIn ? await getEmail() : null;
  return { loggedIn, email: email ?? undefined };
}
