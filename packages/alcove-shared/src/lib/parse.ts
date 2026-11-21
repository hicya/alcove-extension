export interface ParsedArticle {
  title: string;
  author: string | null;
  siteName: string | null;
  excerpt: string | null;
  content: string;
  textContent: string;
  wordCount: number;
  estimatedReadTime: number;
}
