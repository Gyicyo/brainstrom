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

