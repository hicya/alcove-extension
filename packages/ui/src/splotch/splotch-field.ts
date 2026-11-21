// Splotch fields as CSS backgrounds (root DESIGN.md, "Splotch motif"). Plain TypeScript with no
// styles, so any web app (including Emotion-styled hicya.org) can import it from
// `@hicya/ui/splotch-field`.
import { SPLOTCH_FIELD_SIZE, SPLOTCH_FIELDS, SPLOTCH_INNER_SHADOW } from "@hicya/splotch";

import type { SplotchField, SplotchNode } from "@hicya/splotch";

function attributeName(prop: string): string {
  return prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/'/g, "&apos;").replace(/</g, "&lt;");
}

function nodeMarkup(node: SplotchNode): string {
  const attrs = Object.entries(node.attrs)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([prop, value]) => ` ${attributeName(prop)}='${escapeAttribute(value)}'`)
    .join("");
  const children = (node.children ?? []).map(nodeMarkup).join("");
  return `<${node.tag}${attrs}>${children}</${node.tag}>`;
}

/** A field as standalone SVG markup, covering its box (sliced, centered) at any aspect ratio. */
export function splotchFieldSvg(field: SplotchField): string {
  const size = String(SPLOTCH_FIELD_SIZE);
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${size} ${size}' ` +
    `preserveAspectRatio='xMidYMid slice'>${SPLOTCH_FIELDS[field].map(nodeMarkup).join("")}</svg>`
  );
}

const dataUrls = new Map<SplotchField, string>();

/** A field as a `data:` URL, safe inside CSS `url("…")`. Cached per field. */
export function splotchFieldDataUrl(field: SplotchField): string {
  const cached = dataUrls.get(field);
  if (cached !== undefined) return cached;
  const encoded = splotchFieldSvg(field)
    .replace(/%/g, "%25")
    .replace(/#/g, "%23")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/"/g, "%22");
  const url = `data:image/svg+xml,${encoded}`;
  dataUrls.set(field, url);
  return url;
}

function rgba(hex: string, alpha: number): string {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  return `rgba(${channels.join(", ")}, ${String(alpha)})`;
}

/** The pressed-in top shadow as a CSS gradient over the element's height. */
export const SPLOTCH_SHADOW_GRADIENT = `linear-gradient(to bottom, ${rgba(
  SPLOTCH_INNER_SHADOW.color,
  SPLOTCH_INNER_SHADOW.opacity,
)}, ${rgba(SPLOTCH_INNER_SHADOW.color, 0)} ${String(SPLOTCH_INNER_SHADOW.depth * 100)}%)`;

/**
 * CSS `background-image` for splotch text: the pressed-in shadow over the field. Pair it with
 * `background-size: 100% 100%, cover`, `background-position: center`, `no-repeat` and
 * `background-clip: text`.
 */
export function splotchTextBackground(field: SplotchField): string {
  return `${SPLOTCH_SHADOW_GRADIENT}, url("${splotchFieldDataUrl(field)}")`;
}
