import type { AgentRecord } from '../db/db';
import { streamChat, streamScribeSummary } from './bridgeApi';

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

// Bridge-based streaming — delegates to pi-agent bridge server
export async function* streamAgentResponse(
  agent: AgentRecord,
  systemPrompt: string,
  maxTokens = 4096,
  signal?: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  throw new Error('请改用 streamAgentChat，传入 sessionId 和 agentName');
}

export async function* streamAgentChat(
  sessionId: number,
  agentName: string,
  message: string,
  _agent: AgentRecord,
  signal?: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  yield* streamChat(sessionId, agentName, message, signal);
}

export { streamScribeSummary };

// Legacy non-streaming call — kept for backward compat
export async function callAgent(
  agent: AgentRecord,
  systemPrompt: string,
  maxTokens = 4096,
  signal?: AbortSignal,
): Promise<string> {
  throw new Error('直接 LLM 调用已不再支持。请使用桥接 API。');
}

export async function* streamAgentResponseWithTools(
  agent: AgentRecord,
  systemPrompt: string,
  tools: ToolDefinition[],
  maxTokens = 4096,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, undefined> {
  throw new Error('工具处理已由 pi-agent 接管。请改用 streamAgentChat。');
}

export async function callAgentWithTools(
  agent: AgentRecord,
  messages: { role: string; content: string }[],
  tools: ToolDefinition[],
  maxTokens = 4096,
  signal?: AbortSignal,
): Promise<{ content: string; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[] }> {
  throw new Error('工具处理已由 pi-agent 接管。请使用桥接 API。');
}
