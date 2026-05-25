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
  throw new Error('Use streamAgentChat with sessionId and agentName instead');
}

export async function* streamAgentChat(
  sessionId: number,
  agentName: string,
  message: string,
  agent: AgentRecord,
  signal?: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  yield* streamChat(sessionId, agentName, message, {
    apiBaseUrl: agent.api_base_url,
    apiKey: agent.api_key,
    modelName: agent.model_name,
  }, signal);
}

export { streamScribeSummary };

// Legacy non-streaming call — kept for backward compat
export async function callAgent(
  agent: AgentRecord,
  systemPrompt: string,
  maxTokens = 4096,
  signal?: AbortSignal,
): Promise<string> {
  throw new Error('Direct LLM calls are no longer supported. Use bridge API.');
}

export async function* streamAgentResponseWithTools(
  agent: AgentRecord,
  systemPrompt: string,
  tools: ToolDefinition[],
  maxTokens = 4096,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, undefined> {
  throw new Error('Tool handling is now done by pi-agent. Use streamAgentChat instead.');
}

export async function callAgentWithTools(
  agent: AgentRecord,
  messages: { role: string; content: string }[],
  tools: ToolDefinition[],
  maxTokens = 4096,
  signal?: AbortSignal,
): Promise<{ content: string; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[] }> {
  throw new Error('Tool handling is now done by pi-agent. Use bridge API instead.');
}
