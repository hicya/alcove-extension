import { describe, it, expect } from "vitest";

import {
  isBackgroundMessage,
  toActionResponse,
  toAuthState,
  toCaptureResponse,
} from "../messaging";

describe("toCaptureResponse", () => {
  const valid = {
    title: "T",
    author: null,
    siteName: "s",
    excerpt: null,
    content: "<p/>",
    textContent: "",
    wordCount: 0,
    estimatedReadTime: 1,
    url: "https://a.b/",
  };

  it("keeps valid results and drops unknown fields", () => {
    expect(toCaptureResponse({ ...valid, extra: true })).toEqual(valid);
  });

  it("keeps error results", () => {
    expect(toCaptureResponse({ error: "nope" })).toEqual({ error: "nope" });
  });

  it("rejects malformed values", () => {
    expect(toCaptureResponse(undefined)).toEqual({ error: "The page could not be read" });
    expect(toCaptureResponse({ ...valid, wordCount: "3" })).toEqual({
      error: "The page could not be read",
    });
  });
});

describe("options page messages", () => {
  it("recognises background messages", () => {
    expect(isBackgroundMessage({ type: "LOGIN" })).toBe(true);
    expect(isBackgroundMessage({ type: "CAPTURE_ARTICLE" })).toBe(false);
    expect(isBackgroundMessage("LOGIN")).toBe(false);
  });

  it("parses auth state defensively", () => {
    expect(toAuthState({ loggedIn: true, email: "a@b.c" })).toEqual({
      loggedIn: true,
      email: "a@b.c",
    });
    expect(toAuthState({ loggedIn: "yes" })).toEqual({ loggedIn: false });
    expect(toAuthState(undefined)).toEqual({ loggedIn: false });
  });

  it("parses action responses", () => {
    expect(toActionResponse({ ok: true })).toEqual({ ok: true, error: undefined });
    expect(toActionResponse({ error: "x" })).toEqual({ ok: false, error: "x" });
    expect(toActionResponse(undefined).error).toBeDefined();
  });
});

describe("sign-in provider messages", () => {
  it("accepts LOGIN with Apple, Google or no provider", () => {
    expect(isBackgroundMessage({ type: "LOGIN" })).toBe(true);
    expect(isBackgroundMessage({ type: "LOGIN", provider: "apple" })).toBe(true);
    expect(isBackgroundMessage({ type: "LOGIN", provider: "google" })).toBe(true);
  });
  it("rejects unknown providers", () => {
    expect(isBackgroundMessage({ type: "LOGIN", provider: "github" })).toBe(false);
  });
});
