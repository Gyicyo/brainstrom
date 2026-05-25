export function createStreamFn(apiConfig) {
  const { apiBaseUrl, apiKey, modelName } = apiConfig;
  const baseUrl = apiBaseUrl.replace(/\/$/, '');

  return async function streamFn(model, messages, options) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        stream: true,
        max_tokens: options?.maxTokens ?? 4096,
        tools: options?.tools,
        tool_choice: options?.tool_choice,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error ${response.status}: ${text.slice(0, 200)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    return {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return { done: true, value: undefined };
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const payload = trimmed.slice(6);
            if (payload === '[DONE]') return { done: true, value: undefined };
            try { return { done: false, value: JSON.parse(payload) }; }
            catch { continue; }
          }
        }
      },
    };
  };
}
