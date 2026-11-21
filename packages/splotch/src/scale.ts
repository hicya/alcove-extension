/**
 * How much splotch text grows with the system font size (Dynamic Type, Android font scale),
 * matching React Native Text: it follows `fontScale`, `maxFontSizeMultiplier` caps it when it is
 * 1 or more (0 or absent means no cap), and `allowFontScaling: false` turns it off. `maxWidth`
 * then shrinks the result so the text never grows past the room it has (no clipping).
 */
export function splotchTextScale({
  fontScale,
  width,
  maxFontSizeMultiplier,
  maxWidth,
  allowFontScaling = true,
}: {
  fontScale: number;
  /** The text box width at scale 1. */
  width: number;
  maxFontSizeMultiplier?: number;
  maxWidth?: number;
  allowFontScaling?: boolean;
}): number {
  let scale = allowFontScaling && fontScale > 0 ? fontScale : 1;
  if (maxFontSizeMultiplier !== undefined && maxFontSizeMultiplier >= 1) {
    scale = Math.min(scale, maxFontSizeMultiplier);
  }
  if (maxWidth !== undefined && maxWidth > 0 && width > 0) {
    scale = Math.min(scale, maxWidth / width);
  }
  return scale;
}
