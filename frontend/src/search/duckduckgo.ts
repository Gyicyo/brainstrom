import type { SearchResult } from './index';

export async function duckduckgoSearch(query: string): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const data = await resp.json();
  const results: SearchResult[] = [];
  if (data.AbstractText) {
    results.push({ title: data.Headline || 'Summary', snippet: data.AbstractText, url: data.AbstractURL || '' });
  }
  if (Array.isArray(data.RelatedTopics)) {
    for (const topic of data.RelatedTopics.slice(0, 8)) {
      if (topic.Text) results.push({ title: topic.Text.split(' - ')[0], snippet: topic.Text, url: topic.FirstURL || '' });
    }
  }
  return results;
}
