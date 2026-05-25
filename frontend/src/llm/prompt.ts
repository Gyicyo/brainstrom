import type { AgentRecord, MessageRecord } from '../db/db';
import { db } from '../db/db';
import { getRoundMessages, getRounds, getSessionAgents } from '../db/helpers';

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
  const [rounds, currentMsgs, saRecords] = await Promise.all([
    getRounds(sessionId),
    getRoundMessages(roundId),
    getSessionAgents(sessionId),
  ]);

  // Build agent name map covering both preset and generated agents
  const genAgentIds = saRecords.filter(sa => sa.generated_agent_id != null).map(sa => sa.generated_agent_id!);
  const genAgents = genAgentIds.length > 0 ? await db.generatedAgents.bulkGet(genAgentIds) : [];
  const genNameMap = new Map(genAgents.filter(Boolean).map(a => [a!.id!, a!.name]));

  const presetAgentIds = [...new Set(saRecords.map(sa => sa.agent_id))];
  const presetAgents = presetAgentIds.length > 0 ? await db.agents.bulkGet(presetAgentIds) : [];
  const presetNameMap = new Map(presetAgents.filter(Boolean).map(a => [a!.id!, a!.name]));

  function agentName(messageAgentId: number): string {
    const sa = saRecords.find(s => s.generated_agent_id === messageAgentId);
    if (sa) return genNameMap.get(messageAgentId) || 'Unknown';
    return presetNameMap.get(messageAgentId) || 'Unknown';
  }

  // Previous rounds: full discussion + scribe summary
  for (const r of rounds) {
    if (r.round_number >= roundNumber) continue;
    const prevMsgs = await getRoundMessages(r.id!);
    const prevLines: string[] = [];
    for (const m of prevMsgs) {
      if (m.is_human) prevLines.push(`Human: ${m.content}`);
      else if (m.content && m.agent_id != null) prevLines.push(`${agentName(m.agent_id)}: ${m.content}`);
    }
    if (prevLines.length > 0) parts.push(`## Round ${r.round_number} Discussion\n${prevLines.join('\n')}`);
    if (r.scribe_summary) parts.push(`## Round ${r.round_number} Summary\n${r.scribe_summary}`);
  }

  // Current round messages
  if (currentMsgs.length > 0) {
    const msgLines: string[] = [];
    for (const m of currentMsgs) {
      if (m.is_human) msgLines.push(`Human: ${m.content}`);
      else if (m.content && m.agent_id != null) msgLines.push(`${agentName(m.agent_id)}: ${m.content}`);
    }
    if (msgLines.length) parts.push('## Current Discussion\n' + msgLines.join('\n'));
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
- name: Role name (concise, like "Product Manager" or "Design Lead")
- personality: One-sentence role description that sounds like a real person
- system_prompt: Detailed instruction prompt for this role

IMPORTANT guidelines for the system_prompt:
- Instruct the agent to speak naturally, like a human in a conversation, not like an AI assistant
- Avoid formal listing, bullet points, or report-style output
- Encourage casual, conversational tone — use contractions, vary sentence length, show personality
- The agent should disagree, ask questions, build on others' ideas — just like a real brainstorming participant
- No preamble like "As an AI..." or "As a language model..."
- Keep responses concise and to the point, like how real people talk in meetings

Respond in this JSON format:
{
  "agents": [
    { "name": "...", "personality": "...", "system_prompt": "..." }
  ]
}

Generated agents are participants. The scribe (a separate preset agent) will summarize discussions.`;
}
