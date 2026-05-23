import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../db/db';
import {
  getSession, getCurrentRound, getRoundMessages, getRoundThreads, getThreadMessages,
  getSessionAgents, getAgent, createRound, createMessage, updateMessage,
  updateRound, createThread, createThreadMessage, updateThreadMessage,
  getRounds, updateSession,
  deleteSession as deleteSessionFromDb,
} from '../db/helpers';
import { streamAgentResponse, callAgent, callAgentWithTools } from '../llm/stream';
import type { ToolDefinition } from '../llm/stream';
import { buildSystemPrompt, buildDivergentContext } from '../llm/prompt';
import { searchWeb } from '../search';
import type { RoundDetailType } from '../types';

export function useSession(sessionId: number) {
  const [roundDetail, setRoundDetail] = useState<RoundDetailType | null>(null);
  const [respondingAgentId, setRespondingAgentId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingAgentIds, setStreamingAgentIds] = useState<Set<number>>(new Set());
  const [streamContents, setStreamContents] = useState<Record<number, string>>({});
  const [searchStatus, setSearchStatus] = useState<Record<number, { status: string; query?: string }>>({});

  const abortRef = useRef<AbortController | null>(null);

  // Cancel all in-flight LLM requests on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  async function resolveAgentForLLMCall(
    agentInfo: { id: number; name: string; is_scribe: boolean },
  ): Promise<import('../db/db').AgentRecord | undefined> {
    const saRecords = await getSessionAgents(sessionId);
    const sa = saRecords.find(s => s.generated_agent_id === agentInfo.id);
    if (sa) return getAgent(sa.agent_id);
    return getAgent(agentInfo.id);
  }

  const isStreaming = streamingAgentIds.size > 0;

  async function buildRoundDetail(
    session: { id?: number; topic: string; status: string; current_round: number; created_at: string },
    round: { id?: number; session_id: number; round_number: number; scribe_summary: string; created_at: string },
  ): Promise<RoundDetailType> {
    const rid = round.id!;
    const sid = session.id!;

    const saRecords = await getSessionAgents(sid);
    const saAgentIds = [...new Set(saRecords.map(sa => sa.agent_id))];
    const saAgents = saAgentIds.length > 0 ? await db.agents.bulkGet(saAgentIds) : [];
    const saAgentMap = new Map(saAgents.filter(Boolean).map(a => [a!.id!, a!]));
    const generatedAgentIds = saRecords.filter(sa => sa.generated_agent_id != null).map(sa => sa.generated_agent_id!);
    const genAgents = generatedAgentIds.length > 0 ? await db.generatedAgents.bulkGet(generatedAgentIds) : [];
    const genAgentMap = new Map(genAgents.filter(Boolean).map(a => [a!.id!, a!]));
    const agentsAttached: { id: number; name: string; is_scribe: boolean }[] = [];
    for (const sa of saRecords) {
      if (sa.generated_agent_id != null) {
        const genAgent = genAgentMap.get(sa.generated_agent_id);
        if (genAgent) agentsAttached.push({ id: genAgent.id!, name: genAgent.name, is_scribe: sa.is_scribe });
      } else {
        const agent = saAgentMap.get(sa.agent_id);
        if (agent) agentsAttached.push({ id: agent.id!, name: agent.name, is_scribe: sa.is_scribe });
      }
    }

    const msgRecords = await getRoundMessages(rid);
    const publicMessages = msgRecords.map(m => {
      let agentName = '';
      if (m.agent_id != null) {
        agentName = agentsAttached.find(a => a.id === m.agent_id)?.name || '';
      }
      return {
        id: m.id!,
        agent_id: m.agent_id,
        agent_name: agentName,
        is_human: m.is_human,
        content: m.content,
        created_at: m.created_at,
      };
    });

    const threadRecords = await getRoundThreads(rid);
    const privateThreads = [];
    for (const t of threadRecords) {
      const agentName = agentsAttached.find(a => a.id === t.agent_id)?.name || '';
      const tmRecords = await getThreadMessages(t.id!);
      const tmList = tmRecords.map(tm => ({
        id: tm.id!,
        is_human: tm.is_human,
        content: tm.content,
        created_at: tm.created_at,
      }));
      privateThreads.push({
        id: t.id!,
        agent_id: t.agent_id,
        agent_name: agentName,
        messages: tmList,
        created_at: t.created_at,
      });
    }

    return {
      session: {
        id: sid,
        topic: session.topic,
        status: session.status,
        current_round: session.current_round,
        created_at: session.created_at,
      },
      current_round: {
        id: rid,
        round_number: round.round_number,
        scribe_summary: round.scribe_summary || '',
        public_messages: publicMessages,
        private_threads: privateThreads,
        created_at: round.created_at,
      },
      agents_attached: agentsAttached,
    };
  }

  async function buildDetail(sid: number, roundNum: number): Promise<RoundDetailType | null> {
    const session = await getSession(sid);
    if (!session) return null;
    const round = await getCurrentRound(sid, roundNum);
    if (!round) return null;
    return buildRoundDetail(session, round);
  }

  const load = useCallback(async () => {
    try {
      setError(null);
      const session = await getSession(sessionId);
      if (!session) { setRoundDetail(null); return; }
      const round = await getCurrentRound(sessionId, session.current_round);
      if (!round) { setRoundDetail(null); return; }
      setRoundDetail(await buildRoundDetail(session, round));
    } catch {
      setRoundDetail(null);
    }
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  const handleCreateRound = async (initialMessage: string) => {
    setLoading(true);
    try {
      const session = await getSession(sessionId);
      if (!session) throw new Error('Session not found');

      const nextNum = session.current_round + 1;
      const rid = await createRound({ session_id: sessionId, round_number: nextNum, scribe_summary: '' });
      await updateSession(sessionId, { current_round: nextNum });

      if (initialMessage) {
        await createMessage({ round_id: rid, agent_id: null, is_human: true, content: initialMessage });
      }

      const detail = await buildDetail(sessionId, nextNum);
      setRoundDetail(detail);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const handleStartDivergent = async () => {
    if (!roundDetail) return;
    setLoading(true);
    setError(null);
    try {
      const roundId = roundDetail.current_round.id;
      const nonScribeAgents = roundDetail.agents_attached.filter(a => !a.is_scribe);

      // Create empty messages for each agent
      const entries: { agentId: number; messageId: number }[] = [];
      for (const a of nonScribeAgents) {
        const agent = await resolveAgentForLLMCall(a);
        if (!agent) continue;
        const mid = await createMessage({
          round_id: roundId,
          agent_id: a.id,
          is_human: false,
          content: '',
        });
        entries.push({ agentId: a.id, messageId: mid });
      }

      // Refresh detail so UI shows empty agent messages
      const freshDetail = await buildDetail(sessionId, roundDetail.current_round.round_number);
      setRoundDetail(freshDetail);

      // Build context
      const context = await buildDivergentContext(sessionId, roundDetail.current_round.round_number, roundId);

      // Mark all non-scribe agents as streaming
      const agentIds = nonScribeAgents.map(a => a.id);
      setStreamingAgentIds(new Set(agentIds));
      setStreamContents(Object.fromEntries(agentIds.map(id => [id, ''])));

      // Launch all agent streams in parallel with AbortController
      const abortController = new AbortController();
      abortRef.current = abortController;

      const searchToolDef: ToolDefinition = {
        type: 'function',
        function: {
          name: 'search_web',
          description: 'Search the web for current, up-to-date information',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'The search query' } },
            required: ['query'],
          },
        },
      };

      const promises = entries.map(async ({ agentId, messageId }) => {
        try {
          const agent = await resolveAgentForLLMCall({ id: agentId, name: '', is_scribe: false });
          if (!agent) return;
          let prompt = buildSystemPrompt(
            agent,
            context,
            'Provide your unique perspective on this topic. Be creative and specific.',
          );

          // Phase 1: Non-streaming call with tools to check for search intent
          const { tool_calls } = await callAgentWithTools(
            agent,
            [{ role: 'system', content: prompt }, { role: 'user', content: 'Please provide your response based on the instructions above.' }],
            [searchToolDef],
            4096,
            abortController.signal,
          );

          if (tool_calls && tool_calls.length > 0) {
            setSearchStatus(prev => ({ ...prev, [agentId]: { status: 'searching', query: '' } }));
            for (const tc of tool_calls) {
              try {
                const args = JSON.parse(tc.function.arguments);
                const query = args.query || '';
                setSearchStatus(prev => ({ ...prev, [agentId]: { status: 'searching', query } }));
                const provider = agent.search_provider
                  ? { type: agent.search_provider as 'duckduckgo' | 'custom', apiKey: agent.search_api_key || '', apiUrl: agent.search_api_url || '' }
                  : undefined;
                const results = await searchWeb(query, provider);
                const resultsText = results.map(r => `- ${r.title}: ${r.snippet} (${r.url})`).join('\n');
                prompt = prompt + `\n\n## Web Search Results for "${query}"\n${resultsText || '(No results found)'}`;
              } catch { /* search failed — proceed without */ }
            }
            setSearchStatus(prev => ({ ...prev, [agentId]: { status: 'done', query: '' } }));
          }

          // Phase 2: Stream final response (no tools, content-only)
          let full = '';
          for await (const token of streamAgentResponse(agent, prompt, 4096, abortController.signal)) {
            full += token;
            setStreamContents(prev => ({ ...prev, [agentId]: full }));
          }
          await updateMessage(messageId, { content: full });
        } finally {
          setSearchStatus(prev => {
            const { [agentId]: _, ...rest } = prev;
            return rest;
          });
          setStreamContents(prev => {
            const { [agentId]: _, ...rest } = prev;
            return rest;
          });
          setStreamingAgentIds(prev => {
            const next = new Set(prev);
            next.delete(agentId);
            return next;
          });
        }
      });

      await Promise.allSettled(promises);
      setLoading(false);
      load();
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  };

  const handleMention = async (agentIds: number[], question: string) => {
    if (!roundDetail || agentIds.length === 0) return;
    setRespondingAgentId(agentIds[0]);
    try {
      const roundId = roundDetail.current_round.id;
      const context = await buildDivergentContext(sessionId, roundDetail.current_round.round_number, roundId);

      const searchToolDef: ToolDefinition = {
        type: 'function',
        function: {
          name: 'search_web',
          description: 'Search the web for current, up-to-date information',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'The search query' } },
            required: ['query'],
          },
        },
      };

      for (const agentId of agentIds) {
        const agent = await resolveAgentForLLMCall({ id: agentId, name: '', is_scribe: false });
        if (!agent) continue;

        const tid = await createThread({ round_id: roundId, agent_id: agentId });
        await createThreadMessage({ thread_id: tid, is_human: true, content: question });
        const tmid = await createThreadMessage({ thread_id: tid, is_human: false, content: '' });

        let prompt = buildSystemPrompt(
          agent,
          context + `\n\n## Private Question\n${question}`,
          'Respond to the human\'s private question thoughtfully.',
        );

        // Fire-and-forget streaming per agent with AbortController
        const abortController = new AbortController();
        abortRef.current = abortController;

        setStreamingAgentIds(prev => new Set(prev).add(agentId));
        setStreamContents(prev => ({ ...prev, [agentId]: '' }));

        (async () => {
          try {
            // Phase 1: Check for search intent
            const { tool_calls } = await callAgentWithTools(
              agent,
              [{ role: 'system', content: prompt }, { role: 'user', content: 'Please provide your response based on the instructions above.' }],
              [searchToolDef],
              4096,
              abortController.signal,
            );

            if (tool_calls && tool_calls.length > 0) {
              setSearchStatus(prev => ({ ...prev, [agentId]: { status: 'searching', query: '' } }));
              for (const tc of tool_calls) {
                try {
                  const args = JSON.parse(tc.function.arguments);
                  const query = args.query || '';
                  setSearchStatus(prev => ({ ...prev, [agentId]: { status: 'searching', query } }));
                  const provider = agent.search_provider
                    ? { type: agent.search_provider as 'duckduckgo' | 'custom', apiKey: agent.search_api_key || '', apiUrl: agent.search_api_url || '' }
                    : undefined;
                  const results = await searchWeb(query, provider);
                  const resultsText = results.map(r => `- ${r.title}: ${r.snippet} (${r.url})`).join('\n');
                  prompt = prompt + `\n\n## Web Search Results for "${query}"\n${resultsText || '(No results found)'}`;
                } catch { /* search failed */ }
              }
              setSearchStatus(prev => ({ ...prev, [agentId]: { status: 'done', query: '' } }));
            }

            let full = '';
            for await (const token of streamAgentResponse(agent, prompt, 4096, abortController.signal)) {
              full += token;
              setStreamContents(prev => ({ ...prev, [agentId]: full }));
            }
            await updateThreadMessage(tmid, { content: full });
          } finally {
            setSearchStatus(prev => {
              const { [agentId]: _, ...rest } = prev;
              return rest;
            });
            setStreamContents(prev => {
              const { [agentId]: _, ...rest } = prev;
              return rest;
            });
            setStreamingAgentIds(prev => {
              const next = new Set(prev);
              next.delete(agentId);
              return next;
            });
            load();
          }
        })();
      }

      // Refresh to show threads immediately
      const freshDetail = await buildDetail(sessionId, roundDetail.current_round.round_number);
      setRoundDetail(freshDetail);
    } catch (e: any) {
      setError(e.message);
    }
    setRespondingAgentId(null);
  };

  const handleEndRound = async () => {
    if (!roundDetail) return;
    setLoading(true);
    try {
      const roundId = roundDetail.current_round.id;
      const scribeAgentInfo = roundDetail.agents_attached.find(a => a.is_scribe);
      if (!scribeAgentInfo) throw new Error('No scribe agent configured');

      const scribeAgent = await resolveAgentForLLMCall(scribeAgentInfo);
      if (!scribeAgent) throw new Error('Scribe agent not found');

      const messages = await getRoundMessages(roundId);
      const threads = await getRoundThreads(roundId);

      let discussionText = messages.map(m => {
        const name = m.is_human ? 'Human'
          : roundDetail?.agents_attached.find(a => a.id === m.agent_id)?.name || 'Unknown';
        return `${name}: ${m.content}`;
      }).join('\n\n');

      for (const t of threads) {
        const tms = await getThreadMessages(t.id!);
        const agentName = roundDetail?.agents_attached.find(a => a.id === t.agent_id)?.name || 'Unknown';
        discussionText += '\n\n' + tms.map(tm => {
          const name = tm.is_human ? 'Human' : agentName;
          return `${name}: ${tm.content}`;
        }).join('\n');
      }

      const prompt = buildSystemPrompt(
        scribeAgent,
        discussionText,
        'Summarize this round of discussion concisely. Capture key points, agreements, and disagreements. Be neutral.',
      );
      const summary = await callAgent(scribeAgent, prompt);

      await updateRound(roundId, { scribe_summary: summary });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const handleEndSession = async () => {
    if (!roundDetail) return '';
    try {
      const scribeAgentInfo = roundDetail.agents_attached.find(a => a.is_scribe);
      if (!scribeAgentInfo) throw new Error('No scribe agent configured');

      const scribeAgent = await resolveAgentForLLMCall(scribeAgentInfo);
      if (!scribeAgent) throw new Error('Scribe agent not found');

      const rounds = await getRounds(sessionId);
      const summaries = rounds.filter(r => r.scribe_summary).map(r =>
        `## Round ${r.round_number}\n${r.scribe_summary}`
      ).join('\n\n');

      const prompt = buildSystemPrompt(
        scribeAgent,
        summaries,
        'Synthesize all round summaries into a comprehensive final report. Identify themes, conclusions, and open questions.',
      );
      const report = await callAgent(scribeAgent, prompt);

      await updateSession(sessionId, { status: 'completed' });
      return report;
    } catch (e: any) {
      setError(e.message);
      return '';
    }
  };

  const handleStartNextRound = async () => {
    await handleCreateRound('');
  };

  const handleDeleteSession = async () => {
    await deleteSessionFromDb(sessionId);
  };

  const fetchSummaries = useCallback(async () => {
    const rounds = await getRounds(sessionId);
    return rounds
      .filter(r => r.scribe_summary)
      .map(r => ({
        round_number: r.round_number,
        summary: r.scribe_summary,
        created_at: r.created_at,
      }));
  }, [sessionId]);

  return {
    roundDetail, respondingAgentId, loading, error,
    streamingAgentIds, streamContents, isStreaming, searchStatus,
    handleCreateRound, handleStartDivergent, handleStartNextRound,
    handleEndRound, handleMention, handleEndSession,
    handleDeleteSession, fetchSummaries,
  };
}
