import { Type } from '@sinclair/typebox';

// duckduckgo-search is CommonJS
import pkg from 'duckduckgo-search';
const duckduckgo = pkg.default || pkg;

export function createSearchTool() {
  return {
    name: 'search_web',
    label: 'Search Web',
    description: 'Search the web for current information. Use this when you need up-to-date facts, news, or data.',
    parameters: Type.Object({
      query: Type.String({ description: 'The search query' }),
    }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      try {
        const results = [];
        for await (const result of duckduckgo.text(params.query)) {
          results.push({
            title: result.title,
            snippet: result.body,
            url: result.href,
          });
          if (results.length >= 5) break;
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
