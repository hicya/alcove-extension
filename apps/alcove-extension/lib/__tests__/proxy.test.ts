import { afterEach, describe, it, expect, vi } from "vitest";

import { fetchViaProxy, isHtmlContentType, ProxyFetchError, toProxyPage } from "../proxy";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toProxyPage", () => {
  it("accepts the proxy response shape", () => {
    expect(
      toProxyPage({ html: "<p/>", contentType: "text/html", finalUrl: "https://a.b/" }),
    ).toEqual({ html: "<p/>", contentType: "text/html", finalUrl: "https://a.b/" });
  });

  it("rejects anything else", () => {
    expect(toProxyPage(null)).toBeNull();
    expect(toProxyPage({ html: "<p/>" })).toBeNull();
    expect(toProxyPage({ html: 1, contentType: "text/html", finalUrl: "x" })).toBeNull();
  });
});

describe("isHtmlContentType", () => {
  it("recognises HTML with or without parameters", () => {
    expect(isHtmlContentType("text/html")).toBe(true);
    expect(isHtmlContentType("Text/HTML; charset=utf-8")).toBe(true);
    expect(isHtmlContentType("application/xhtml+xml")).toBe(true);
    expect(isHtmlContentType("application/pdf")).toBe(false);
  });
});

describe("fetchViaProxy", () => {
  it("posts the URL with the access token", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        Response.json({ html: "<p/>", contentType: "text/html", finalUrl: "https://a.b/c" }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await fetchViaProxy("tok", "https://a.b/c");
    expect(page.finalUrl).toBe("https://a.b/c");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sync.hicya.org/proxy/fetch");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(init?.body).toBe(JSON.stringify({ url: "https://a.b/c" }));
  });

  it("throws with the status on failure", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 429 })));
    const error = await fetchViaProxy("tok", "https://a.b/").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ProxyFetchError);
    expect(error).toMatchObject({ status: 429 });
  });

  it("throws on an unexpected body", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(Response.json({ nope: true })));
    await expect(fetchViaProxy("tok", "https://a.b/")).rejects.toThrow("Unexpected proxy response");
  });
});
