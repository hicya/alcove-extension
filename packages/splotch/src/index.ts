// The hicya splotch motif as plain shape data for web and React Native (root DESIGN.md,
// "Splotch motif"). Fields and app shapes come from brand/icons/splotch; render them with
// @hicya/ui (web) or @hicya/splotch/native (Expo).
import type { SplotchNode } from "./types";

export { SPLOTCH_FIELDS, SPLOTCH_GLYPHS } from "./generated";
export { SPLOTCH_APPS } from "./types";
export { splotchTextScale } from "./scale";
export type { SplotchApp, SplotchField, SplotchNode, SplotchNodeAttrs } from "./types";

/** Field coordinates: splotch fields are drawn on a 1024-unit square. */
export const SPLOTCH_FIELD_SIZE = 1024;
/** Shape coordinates: app glyphs and the done mark are drawn on a 64-unit square. */
export const SPLOTCH_SHAPE_SIZE = 64;

/** The done mark: a disc with the check cut out (white is the window, black is cut out). */
export const SPLOTCH_CHECK_DISC: readonly SplotchNode[] = [
  { tag: "circle", attrs: { cx: "32", cy: "32", r: "30", fill: "#fff" } },
  {
    tag: "path",
    attrs: {
      d: "M18 33 27.5 42.5 46 22",
      fill: "none",
      stroke: "#000",
      strokeWidth: "7",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
  },
];

/**
 * The pressed-in look: a soft shadow along the top inside edge of the window, as a vertical
 * gradient laid over the field inside the mask (no filters, so every renderer draws it).
 */
export const SPLOTCH_INNER_SHADOW = {
  color: "#1a0b2e",
  opacity: 0.35,
  /** Fraction of the shape's height the shadow fades over. */
  depth: 0.18,
} as const;
