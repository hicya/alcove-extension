/**
 * In-page save feedback. `renderToast` is serialized by chrome.scripting.executeScript and
 * runs in the page's isolated world, so it must stay self-contained: no imports, no
 * closures over module scope. It draws inside a closed shadow root so page styles cannot
 * leak in, announces through a polite live region and honours Reduce Motion.
 */

export type ToastTone = "progress" | "success" | "error";

export interface ToastMessage {
  tone: ToastTone;
  title: string;
  detail?: string;
}

export function renderToast(message: ToastMessage): void {
  const HOST_ID = "alcove-save-toast";
  const DISMISS_MS = message.tone === "progress" ? 15000 : message.tone === "success" ? 3200 : 6000;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  interface ToastHost extends HTMLElement {
    alcoveRoot?: ShadowRoot;
    alcoveTimer?: number;
  }

  let host: ToastHost | null = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.setProperty("all", "initial");
    host.style.setProperty("position", "fixed");
    host.style.setProperty("top", "16px");
    host.style.setProperty("right", "16px");
    host.style.setProperty("z-index", "2147483647");
    host.alcoveRoot = host.attachShadow({ mode: "closed" });
    document.documentElement.appendChild(host);
  }
  const root = host.alcoveRoot;
  if (!root) return;

  const accent =
    message.tone === "error" ? "#B84A4A" : message.tone === "success" ? "#4E8051" : "#2D6E73";

  root.innerHTML = "";
  const style = document.createElement("style");
  style.textContent = `
    .toast {
      box-sizing: border-box;
      display: flex;
      gap: 12px;
      align-items: flex-start;
      width: 320px;
      max-width: calc(100vw - 32px);
      padding: 14px 16px;
      background: #fbf7f1;
      color: #241e1a;
      border: 1px solid #d8cbbe;
      border-left: 4px solid ${accent};
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(36, 30, 26, 0.16);
      font: 500 14px/1.4 "Instrument Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity 200ms ease-out, transform 200ms ease-out;
    }
    .toast.visible { opacity: 1; transform: none; }
    .toast.reduce { transition: none; transform: none; }
    .mark {
      flex: none;
      width: 20px;
      height: 20px;
      border-radius: 9999px;
      background: ${accent};
      color: #f4efe7;
      font: 700 12px/20px ui-sans-serif, system-ui, sans-serif;
      text-align: center;
    }
    .title { font-weight: 600; }
    .detail {
      margin-top: 2px;
      color: #6b6058;
      font-weight: 400;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    @media (prefers-color-scheme: dark) {
      .toast { background: #211c19; color: #f3ede4; border-color: #3a322d; }
      .detail { color: #b7aaa0; }
    }
  `;

  const toast = document.createElement("div");
  toast.className = reduceMotion ? "toast reduce" : "toast";
  toast.setAttribute("role", message.tone === "error" ? "alert" : "status");
  toast.setAttribute("aria-live", message.tone === "error" ? "assertive" : "polite");

  const mark = document.createElement("span");
  mark.className = "mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = message.tone === "error" ? "!" : message.tone === "success" ? "✓" : "";

  const body = document.createElement("div");
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = message.title;
  body.appendChild(title);
  if (message.detail) {
    const detail = document.createElement("div");
    detail.className = "detail";
    detail.textContent = message.detail;
    body.appendChild(detail);
  }

  toast.append(mark, body);
  root.append(style, toast);
  requestAnimationFrame(() => toast.classList.add("visible"));

  if (host.alcoveTimer !== undefined) window.clearTimeout(host.alcoveTimer);
  const currentHost = host;
  currentHost.alcoveTimer = window.setTimeout(() => {
    toast.classList.remove("visible");
    window.setTimeout(() => currentHost.remove(), reduceMotion ? 0 : 200);
  }, DISMISS_MS);
}
