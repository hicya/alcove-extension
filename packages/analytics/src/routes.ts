/**
 * Screen and page names report the route template, never the resolved URL, so record ids,
 * usernames and search text cannot become page names. Query strings and fragments are dropped.
 */

const MAX_NAME_LENGTH = 100;

/** Expo Router file segments to a screen name: `["(tabs)", "match", "[id]"]` → `match/id`. */
export function screenNameFromSegments(segments: readonly string[]): string {
  const screenSegments = segments
    .filter((segment) => !/^\(.+\)$/.test(segment) && segment !== "index")
    .map((segment) => {
      const parameter = segment.match(/^\[+\.{0,3}([^\]]+)\]+$/)?.[1];
      return parameter ?? segment;
    });
  return (screenSegments.join("/") || "root").slice(0, MAX_NAME_LENGTH);
}

/** The page reported for any path that matches none of the app's declared routes. */
export const UNKNOWN_ROUTE = "/(other)";

function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

/**
 * Matches a pathname against route patterns such as `/deck/:deckId` or `/docs/*` and returns
 * the first matching pattern. Static segments must match exactly; `:name` matches one segment;
 * a trailing `*` matches the rest. Unmatched paths become {@link UNKNOWN_ROUTE}.
 */
export function routeTemplate(pathname: string, routes: readonly string[]): string {
  const segments = splitPath(pathname);
  for (const route of routes) {
    const pattern = splitPath(route);
    const wildcard = pattern.at(-1) === "*";
    const fixed = wildcard ? pattern.slice(0, -1) : pattern;
    if (wildcard ? segments.length < fixed.length : segments.length !== fixed.length) continue;
    const matches = fixed.every((part, index) => part.startsWith(":") || part === segments[index]);
    if (matches) return route.slice(0, MAX_NAME_LENGTH);
  }
  return UNKNOWN_ROUTE;
}

/** Origin of a referrer, or "" when it is empty or not a URL. Paths and queries are dropped. */
export function referrerOrigin(referrer: string): string {
  if (referrer === "") return "";
  try {
    return new URL(referrer).origin;
  } catch {
    return "";
  }
}
