export type { ParsedArticle } from "./parse";
export { syncPauseCopy } from "./syncPause";
export type { SyncPauseCopy } from "./syncPause";
export {
  INSECURE_ONLY_MESSAGE,
  InsecureOnlyError,
  isInsecureOnlyError,
  isLoopbackHost,
  isProxyUpstreamFailure,
  secureFetchTarget,
  secureFetchUrl,
} from "./secureUrl";
export type { SecureFetchFailure, SecureFetchTarget } from "./secureUrl";

const WORDS_PER_MINUTE = 238;

export function estimateReadTime(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}

export function countWords(text: string): number {
  // Strip HTML tags, then count whitespace-separated words
  const stripped = text.replace(/<[^>]*>/g, " ");
  const words = stripped.trim().split(/\s+/).filter(Boolean);
  return words.length;
}
