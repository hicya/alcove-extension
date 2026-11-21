import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { CAPTURE_SCRIPT, captureTab, parseHtmlInTab, showToast } from "../inject";
import { renderToast } from "../toast";

interface Injection {
  target: { tabId: number };
  files?: string[];
  func?: unknown;
  args?: unknown[];
}

const ARTICLE = {
  title: "Field Notes",
  author: null,
  siteName: "example.org",
  excerpt: null,
  content: "<p>Hello</p>",
  textContent: "Hello",
  wordCount: 1,
  estimatedReadTime: 1,
  url: "https://example.org/notes",
};

let executeScript: ReturnType<
  typeof vi.fn<(injection: Injection) => Promise<{ result?: unknown }[]>>
>;

beforeEach(() => {
  executeScript = vi.fn((injection: Injection) =>
    Promise.resolve(injection.files ? [{}] : [{ result: ARTICLE }]),
  );
  vi.stubGlobal("chrome", { scripting: { executeScript } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("captureTab", () => {
  it("injects capture.js, then calls it in the same tab", async () => {
    const result = await captureTab(9);

    expect(result).toEqual(ARTICLE);
    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(executeScript.mock.calls[0][0]).toEqual({
      target: { tabId: 9 },
      files: [CAPTURE_SCRIPT],
    });
    const second = executeScript.mock.calls[1][0];
    expect(second.target).toEqual({ tabId: 9 });
    expect(typeof second.func).toBe("function");
  });

  it("calls the capture API exposed by capture.js", async () => {
    await captureTab(9);
    const func = executeScript.mock.calls[1][0].func;
    const captureDocument = vi.fn(() => ARTICLE);
    vi.stubGlobal("alcoveCapture", { captureDocument, parseHtml: vi.fn() });
    expect(typeof func === "function" ? func() : undefined).toEqual(ARTICLE);
    expect(captureDocument).toHaveBeenCalledOnce();
  });

  it("turns injection failures into an error result", async () => {
    executeScript.mockRejectedValueOnce(new Error("Cannot access contents of the page"));
    expect(await captureTab(9)).toEqual({ error: "Cannot access contents of the page" });
  });

  it("rejects malformed results", async () => {
    executeScript.mockImplementation((injection: Injection) =>
      Promise.resolve(injection.files ? [{}] : [{ result: { title: 5 } }]),
    );
    expect(await captureTab(9)).toEqual({ error: "The page could not be read" });
  });

  it("passes through parse errors from the page", async () => {
    executeScript.mockImplementation((injection: Injection) =>
      Promise.resolve(injection.files ? [{}] : [{ result: { error: "No article" } }]),
    );
    expect(await captureTab(9)).toEqual({ error: "No article" });
  });
});

describe("parseHtmlInTab", () => {
  it("passes the fetched HTML and URL as arguments", async () => {
    const result = await parseHtmlInTab(2, "<p>Hi</p>", "https://example.org/notes");
    expect(result).toEqual(ARTICLE);
    expect(executeScript.mock.calls[1][0].args).toEqual(["<p>Hi</p>", "https://example.org/notes"]);
  });
});

describe("showToast", () => {
  it("injects the self-contained renderer with the message", async () => {
    const message = { tone: "success" as const, title: "Saved to Alcove" };
    await showToast(5, message);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 5 },
      func: renderToast,
      args: [message],
    });
  });

  it("swallows failures on restricted pages", async () => {
    executeScript.mockRejectedValueOnce(new Error("Cannot access a chrome:// URL"));
    await expect(showToast(5, { tone: "error", title: "x" })).resolves.toBeUndefined();
  });
});
