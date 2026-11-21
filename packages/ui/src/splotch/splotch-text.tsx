// Text (normally the hicya name) filled with a splotch field (root DESIGN.md, "Splotch motif").
// The web counterpart of SplotchText in @hicya/splotch/native. The text stays real, selectable
// text; the field is a clipped background, so it falls back to solid ink where clipping a
// background to text is unsupported and in forced-colors mode.

import classnames from "classnames";

import { splotchTextBackground } from "./splotch-field";
import styles from "./splotch-text.module.scss";

import type { SplotchField } from "@hicya/splotch";
import type { CSSProperties, ReactNode } from "react";

export interface SplotchTextProps {
  children: ReactNode;
  /** Defaults to `hicya`, the every-color field reserved for the hicya name. */
  field?: SplotchField;
  /** The element to render; defaults to an inline `span`. */
  as?: "span" | "p" | "div" | "h1" | "h2" | "h3" | "strong";
  className?: string;
}

export function SplotchText({
  children,
  field = "hicya",
  as: Element = "span",
  className,
}: SplotchTextProps) {
  const style: CSSProperties & Record<"--splotch-text-fill", string> = {
    "--splotch-text-fill": splotchTextBackground(field),
  };
  return (
    <Element className={classnames(styles.text, className)} style={style}>
      {children}
    </Element>
  );
}
