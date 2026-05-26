export function buildModel(apiConfig) {
  return {
    id: apiConfig.modelName || 'gpt-4o',
    api: 'openai-completions',
    provider: 'custom',
    baseUrl: apiConfig.apiBaseUrl || 'https://api.openai.com/v1',
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    maxTokens: 16384,
    contextWindow: 128000,
  };
}
