import { AssistantMessageEventStream } from '@earendil-works/pi-ai';

export function createStreamFn(apiConfig) {
  const { apiBaseUrl, apiKey, modelName } = apiConfig;
  const baseUrl = apiBaseUrl.replace(/\/$/, '');

  return function streamFn(model, llmContext, options) {
    const stream = new AssistantMessageEventStream();

    (async () => {
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName,
            messages: llmContext.messages,
            stream: true,
            max_tokens: options?.maxTokens ?? 4096,
            tools: llmContext.tools?.length > 0
              ? llmContext.tools.map(t => ({
                  type: 'function',
                  function: { name: t.name, description: t.description || '', parameters: t.parameters || {} },
                }))
              : undefined,
          }),
          signal: options?.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`API error ${response.status}: ${text.slice(0, 200)}`);
        }
        if (!response.body) throw new Error('Response body is empty');

        const output = {
          role: 'assistant',
          content: [],
          stopReason: 'stop',
          timestamp: Date.now(),
        };

        stream.push({ type: 'start', partial: output });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let textBlock = null;
        let hasFinishReason = false;

        const ensureTextBlock = () => {
          if (!textBlock) {
            textBlock = { type: 'text', text: '' };
            output.content.push(textBlock);
            stream.push({ type: 'text_start', contentIndex: output.content.length - 1, partial: output });
          }
          return textBlock;
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const payload = trimmed.slice(6);
            if (payload === '[DONE]') continue;
            let chunk;
            try {
              chunk = JSON.parse(payload);
            } catch {
              continue;
            }

            const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
            if (!choice) continue;

            if (choice.finish_reason) {
              output.stopReason = choice.finish_reason === 'tool_calls' ? 'toolUse' : 'stop';
              hasFinishReason = true;
            }

            if (choice.delta?.content) {
              const block = ensureTextBlock();
              block.text += choice.delta.content;
              stream.push({
                type: 'text_delta',
                contentIndex: output.content.indexOf(block),
                delta: choice.delta.content,
                partial: output,
              });
            }

            if (choice.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                let existing = output.content.find(
                  b => b.type === 'toolCall' && b.streamIndex === tc.index
                );
                if (!existing) {
                  existing = {
                    type: 'toolCall',
                    id: tc.id || '',
                    name: tc.function?.name || '',
                    arguments: {},
                    partialArgs: '',
                    streamIndex: tc.index,
                  };
                  output.content.push(existing);
                  stream.push({
                    type: 'toolcall_start',
                    contentIndex: output.content.indexOf(existing),
                    partial: output,
                  });
                }
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) {
                  existing.partialArgs += tc.function.arguments;
                  try { existing.arguments = JSON.parse(existing.partialArgs); }
                  catch { /* incomplete JSON */ }
                }
              }
            }
          }
        }

        for (const block of output.content) {
          const ci = output.content.indexOf(block);
          if (block.type === 'text') {
            stream.push({ type: 'text_end', contentIndex: ci, content: block.text, partial: output });
          } else if (block.type === 'toolCall') {
            delete block.partialArgs;
            delete block.streamIndex;
            stream.push({ type: 'toolcall_end', contentIndex: ci, toolCall: block, partial: output });
          }
        }

        if (!hasFinishReason) {
          output.stopReason = 'stop';
        }
        stream.push({ type: 'done', reason: output.stopReason, message: output });
        stream.end();
      } catch (err) {
        stream.push({
          type: 'error',
          reason: options?.signal?.aborted ? 'aborted' : 'error',
          error: { role: 'assistant', content: [], stopReason: 'error', errorMessage: err.message, timestamp: Date.now() },
        });
        stream.end();
      }
    })();

    return stream;
  };
}
