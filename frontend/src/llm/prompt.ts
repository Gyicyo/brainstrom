import type { AgentRecord, MessageRecord } from '../db/db';
import { db } from '../db/db';
import { getRoundMessages, getRounds } from '../db/helpers';

export function buildSystemPrompt(
  agent: AgentRecord,
  context: string,
  taskDescription: string,
): string {
  const parts: string[] = [];
  parts.push(`You are ${agent.name}.${agent.personality ? ' ' + agent.personality : ''}`);
  if (agent.system_prompt) {
    parts.push(`Your behavior instructions: ${agent.system_prompt}`);
  }
  parts.push(`## Current Context\n${context}`);
  parts.push(`## Task\n${taskDescription}`);
  return parts.join('\n\n');
}

export async function buildDivergentContext(
  sessionId: number,
  roundNumber: number,
  roundId: number,
): Promise<string> {
  const parts: string[] = [];
  const [rounds, currentMsgs] = await Promise.all([
    getRounds(sessionId),
    getRoundMessages(roundId),
  ]);

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

  // Current round messages — batch-fetch agents to avoid N+1
  const agentIds = [...new Set(
    currentMsgs.filter(m => m.agent_id != null).map(m => m.agent_id!)
  )];
  const agents = agentIds.length > 0 ? await db.agents.bulkGet(agentIds) : [];
  const agentMap = new Map(agents.filter(Boolean).map(a => [a!.id!, a!]));

  const msgLines: string[] = [];
  for (const m of currentMsgs) {
    if (m.is_human) {
      msgLines.push(`Human: ${m.content}`);
    } else if (m.content && m.agent_id != null) {
      const agent = agentMap.get(m.agent_id);
      msgLines.push(`${agent?.name || 'Unknown'}: ${m.content}`);
    }
  }
  if (msgLines.length) {
    parts.push('## Current Discussion\n' + msgLines.join('\n'));
  }

  return parts.join('\n\n');
}

export function buildGeneratorPrompt(
  generatorName: string,
  topic: string,
  initialContext: string,
  count: number,
): string {
  return `You are ${generatorName}. Generate ${count} discussion agents for a brainstorming session.
Topic: ${topic}
Initial context: ${initialContext}

For each agent provide:
- name: Role name
- personality: One-sentence role description
- system_prompt: Detailed instruction prompt for this role

Respond in this JSON format:
{
  "agents": [
    { "name": "...", "personality": "...", "system_prompt": "..." }
  ]
}

I (the generator) will serve as the scribe who summarizes discussions. Generated agents are all participants.`;
}
