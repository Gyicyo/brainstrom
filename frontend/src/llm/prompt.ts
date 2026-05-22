import type { AgentRecord, MessageRecord, RoundRecord } from '../db/db';
import { getAgent, getRoundMessages, getRounds } from '../db/helpers';

export function buildSystemPrompt(
  agent: AgentRecord,
  context: string,
  taskDescription: string,
): string {
  return [
    `You are ${agent.name}. ${agent.personality}`,
    `Your behavior instructions: ${agent.system_prompt}`,
    `## Current Context\n${context}`,
    `## Task\n${taskDescription}`,
  ].join('\n\n');
}

export async function buildDivergentContext(
  sessionId: number,
  roundNumber: number,
  roundId: number,
): Promise<string> {
  const parts: string[] = [];
  const rounds = await getRounds(sessionId);

  // Initial message from round 1
  const firstRound = rounds.find(r => r.round_number === 1);
  if (firstRound) {
    const msgs = await getRoundMessages(firstRound.id!);
    const humanMsg = msgs.find(m => m.is_human);
    if (humanMsg?.content) {
      parts.push(`## Initial Context\n${humanMsg.content}`);
    }
  }

  // Previous scribe summaries
  for (const r of rounds) {
    if (r.round_number < roundNumber && r.scribe_summary) {
      parts.push(`## Round ${r.round_number} Summary\n${r.scribe_summary}`);
    }
  }

  // Current round messages
  const currentMsgs = await getRoundMessages(roundId);
  const msgLines: string[] = [];
  for (const m of currentMsgs) {
    if (m.is_human) {
      msgLines.push(`Human: ${m.content}`);
    } else if (m.content && m.agent_id != null) {
      const agent = await getAgent(m.agent_id);
      msgLines.push(`${agent?.name || 'Unknown'}: ${m.content}`);
    }
  }
  if (msgLines.length) {
    parts.push('## Current Discussion\n' + msgLines.join('\n'));
  }

  return parts.join('\n\n');
}
