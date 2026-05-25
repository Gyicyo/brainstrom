export function createSearchTool() {
  return {
    name: 'search_web',
    label: 'Search Web',
    description: 'Search the web for current information. Use this when you need up-to-date facts, news, or data.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'The search query' } }, required: ['query'] },
    execute: async (toolCallId, params, signal, onUpdate) => {
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`;
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const html = await resp.text();
        const results = [];
        const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;

        let match;
        while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
          const url = match[1].replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, '').replace(/%3A/g, ':').replace(/%2F/g, '/');
          const title = match[2].replace(/<[^>]*>/g, '').trim();
          const snippet = snippetRegex.exec(html.slice(match.index + match[0].length))?.[1]?.replace(/<[^>]*>/g, '').trim() || '';
          results.push({ title, snippet, url: decodeURIComponent(url) });
        }

        const text = results.map(r =>
          `- ${r.title}: ${r.snippet} (${r.url})`
        ).join('\n');

        return {
          content: [{ type: 'text', text: text || '(No results found)' }],
          details: { urls: results.map(r => r.url) },
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Search failed: ${err.message}` }],
          details: {},
          isError: true,
        };
      }
    },
  };
}
