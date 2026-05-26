import type { SearchResult } from './index';

export async function customSearch(query: string, apiKey: string, apiUrl: string): Promise<SearchResult[]> {
  const sep = apiUrl.includes('?') ? '&' : '?';
  const url = `${apiUrl}${sep}q=${encodeURIComponent(query)}`;
  try {
    const resp = await fetch(url, {
      headers: { 'X-Api-Key': apiKey },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const items = data.items || data.results || data.organic_results || [];
    return items.slice(0, 8).map((item: any) => ({
      title: item.title || '',
      snippet: item.snippet || item.description || '',
      url: item.link || item.url || '',
    }));
  } catch { return []; }
}
