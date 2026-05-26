import { streamChat, streamScribeSummary } from './bridgeApi';

export async function* streamAgentChat(
  sessionId: number,
  agentName: string,
  message: string,
  signal?: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  yield* streamChat(sessionId, agentName, message, signal);
}

export { streamScribeSummary };
