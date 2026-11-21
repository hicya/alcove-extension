export const SPLOTCH_APPS = [
  "vexling",
  "coins",
  "darts",
  "habits",
  "flashcards",
  "alcove",
  "plants",
  "keepsake",
  "reach",
  "porchlight",
  "forage",
] as const;

/** An app with its own splotch color family and icon shape. */
export type SplotchApp = (typeof SPLOTCH_APPS)[number];

/** A splotch field: an app's color family, or `hicya`, the every-color field for the name only. */
export type SplotchField = SplotchApp | "hicya";

/** Presentation attributes, named as React (DOM and react-native-svg) props. */
export interface SplotchNodeAttrs {
  x?: string;
  y?: string;
  width?: string;
  height?: string;
  rx?: string;
  cx?: string;
  cy?: string;
  r?: string;
  d?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: string;
  strokeLinecap?: string;
  strokeLinejoin?: string;
  transform?: string;
  opacity?: string;
}

/** One drawable SVG element from brand/icons/splotch. */
export interface SplotchNode {
  tag: "g" | "rect" | "circle" | "path";
  attrs: SplotchNodeAttrs;
  children?: SplotchNode[];
}
