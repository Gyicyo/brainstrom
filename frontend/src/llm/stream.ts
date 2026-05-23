import type { AgentRecord } from '../db/db';

export type StreamEvent =
  | { type: 'content'; text: string }
  | { type: 'tool_call'; name: string; arguments: Record<string, any> };

export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
};

async function fetchCompletions(
  agent: AgentRecord,
  systemPrompt: string,
  maxTokens: number,
  stream: boolean,
  signal?: AbortSignal,
): Promise<Response> {
  const url = `${agent.api_base_url.replace(/\/$/, '')}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agent.api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: agent.model_name,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Please provide your response based on the instructions above.' },
      ],
      max_tokens: maxTokens,
      ...(stream ? { stream: true } : {}),
    }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text.slice(0, 200)}`);
  }

  return resp;
}

export async function* streamAgentResponse(
  agent: AgentRecord,
  systemPrompt: string,
  maxTokens = 4096,
  signal?: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  const resp = await fetchCompletions(agent, systemPrompt, maxTokens, true, signal);

  if (!resp.body) {
    throw new Error('Response body is empty');
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
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
        if (payload === '[DONE]') return;
        try {
          const chunk = JSON.parse(payload);
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // skip unparseable chunks
        }
      }
    }
  } finally {
    reader.cancel();
  }
}

export async function callAgent(
  agent: AgentRecord,
  systemPrompt: string,
  maxTokens = 4096,
  signal?: AbortSignal,
): Promise<string> {
  const resp = await fetchCompletions(agent, systemPrompt, maxTokens, false, signal);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function* streamAgentResponseWithTools(
  agent: AgentRecord,
  systemPrompt: string,
  tools: ToolDefinition[],
  maxTokens = 4096,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, undefined> {
  const url = `${agent.api_base_url.replace(/\/$/, '')}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agent.api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: agent.model_name,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Please provide your response based on the instructions above.' },
      ],
      max_tokens: maxTokens,
      stream: true,
      tools,
    }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text.slice(0, 200)}`);
  }

  if (!resp.body) throw new Error('Response body is empty');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
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
        if (payload === '[DONE]') return;
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            yield { type: 'content', text: delta.content };
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function?.name) {
                yield { type: 'tool_call', name: tc.function.name, arguments: {} };
              }
            }
          }
        } catch {
          // skip unparseable chunks
        }
      }
    }
  } finally {
    reader.cancel();
  }
}

export async function callAgentWithTools(
  agent: AgentRecord,
  messages: { role: string; content: string }[],
  tools: ToolDefinition[],
  maxTokens = 4096,
  signal?: AbortSignal,
): Promise<{ content: string; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[] }> {
  const url = `${agent.api_base_url.replace(/\/$/, '')}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agent.api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: agent.model_name,
      messages,
      max_tokens: maxTokens,
      tools,
    }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content || '',
    tool_calls: choice?.message?.tool_calls,
  };
}
