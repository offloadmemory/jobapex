import { tool } from "langchain";
import * as z from "zod";
import { search, SafeSearchType } from "duck-duck-scrape";

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

async function tavilySearch(query: string, maxResults: number): Promise<SearchHit[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: maxResults,
    }),
  });
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { results: { title: string; url: string; content: string }[] };
  return data.results.map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
}

async function duckDuckGoSearch(query: string, maxResults: number): Promise<SearchHit[]> {
  const res = await search(query, { safeSearch: SafeSearchType.MODERATE });
  return res.results.slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description.replace(/<[^>]+>/g, ""),
  }));
}

/**
 * Web search tool. Uses Tavily when TAVILY_API_KEY is set, otherwise falls
 * back to keyless DuckDuckGo scraping.
 */
export const webSearch = tool(
  async ({ query, maxResults }: { query: string; maxResults: number }) => {
    const hits = process.env.TAVILY_API_KEY
      ? await tavilySearch(query, maxResults)
      : await duckDuckGoSearch(query, maxResults);
    if (hits.length === 0) return "No results found.";
    return hits
      .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
      .join("\n\n");
  },
  {
    name: "web_search",
    description:
      "Search the web for current information. Returns a numbered list of results with title, URL and snippet.",
    schema: z.object({
      query: z.string().describe("The search query"),
      maxResults: z.number().int().min(1).max(10).default(5).describe("How many results to return"),
    }),
  }
);
