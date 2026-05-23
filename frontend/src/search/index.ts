export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

export async function searchWeb(
  query: string,
  provider?: { type: 'duckduckgo' } | { type: 'custom'; apiKey: string; apiUrl: string },
): Promise<SearchResult[]> {
  if (!provider || provider.type === 'duckduckgo') {
    const { duckduckgoSearch } = await import('./duckduckgo');
    return duckduckgoSearch(query);
  }
  const { customSearch } = await import('./custom');
  return customSearch(query, provider.apiKey, provider.apiUrl);
}
