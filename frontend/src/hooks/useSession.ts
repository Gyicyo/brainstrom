import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../db/db';
import {
  getSession, getCurrentRound, getRoundMessages, getRoundThreads, getThreadMessages,
  getSessionAgents, getAgent, createRound, createMessage, updateMessage,
  updateRound, createThread, createThreadMessage, updateThreadMessage,
  getRounds, updateSession,
  deleteSession as deleteSessionFromDb,
} from '../db/helpers';
import { streamChat, streamScribeSummary, createRoom, deleteRoom } from '../llm/bridgeApi';
import type { RoundDetailType } from '../types';

export function useSession(sessionId: number) {
  const [roundDetail, setRoundDetail] = useState<RoundDetailType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingAgentIds, setStreamingAgentIds] = useState<Set<number>>(new Set());
  const [streamContents, setStreamContents] = useState<Record<number, string>>({});
  const [streamingScribeContent, setStreamingScribeContent] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const roomCreatedRef = useRef(false);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

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

  async function ensureBridgeRoom(agents: { id: number; name: string; is_scribe: boolean }[]) {
    if (roomCreatedRef.current) return;
    const session = await getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const agentConfigs: { name: string; skillContent: string; apiConfig: { apiBaseUrl: string; apiKey: string; modelName: string } }[] = [];
    let scribeConfig: { apiBaseUrl: string; apiKey: string; modelName: string } | undefined;

    for (const a of agents) {
      const saRecords = await getSessionAgents(sessionId);
      const sa = saRecords.find(s => s.generated_agent_id === a.id || s.agent_id === a.id);
      const agentRecord = await getAgent(sa?.agent_id ?? a.id);
      if (!agentRecord) continue;

      // Load SKILL.md content from generated agent
      let skillContent = '';
      if (sa?.generated_agent_id != null) {
        const genAgent = await db.generatedAgents.get(sa.generated_agent_id);
        if (genAgent) skillContent = genAgent.system_prompt || '';
      }

      const config = {
        name: a.name,
        skillContent,
        apiConfig: {
          apiBaseUrl: agentRecord.api_base_url,
          apiKey: agentRecord.api_key,
          modelName: agentRecord.model_name,
        },
      };

      if (a.is_scribe) {
        scribeConfig = config.apiConfig;
      }
      agentConfigs.push(config);
    }

    try {
      await createRoom(sessionId, session.topic, agentConfigs, scribeConfig);
      roomCreatedRef.current = true;
    } catch (err: any) {
      if (!err.message?.includes('409')) throw err;
      roomCreatedRef.current = true;
    }
  }

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

      // Ensure bridge room exists
      await ensureBridgeRoom(roundDetail.agents_attached);

      // Create empty messages for each agent
      const entries: { agentId: number; agentName: string; messageId: number }[] = [];
      for (const a of nonScribeAgents) {
        const mid = await createMessage({
          round_id: roundId,
          agent_id: a.id,
          is_human: false,
          content: '',
        });
        entries.push({ agentId: a.id, agentName: a.name, messageId: mid });
      }

      // Refresh detail so UI shows empty agent messages
      const freshDetail = await buildDetail(sessionId, roundDetail.current_round.round_number);
      setRoundDetail(freshDetail);

      // Mark all non-scribe agents as streaming
      const agentIds = nonScribeAgents.map(a => a.id);
      setStreamingAgentIds(new Set(agentIds));
      setStreamContents(Object.fromEntries(agentIds.map(id => [id, ''])));

      const abortController = new AbortController();
      abortRef.current = abortController;

      const promises = entries.map(async ({ agentId, agentName, messageId }) => {
        try {
          const saRecords = await getSessionAgents(sessionId);
          const sa = saRecords.find(s => s.generated_agent_id === agentId || s.agent_id === agentId);
          const agentRecord = await getAgent(sa?.agent_id ?? agentId);
          if (!agentRecord) return;

          let full = '';
          for await (const token of streamChat(sessionId, agentName, roundDetail.session.topic, {
            apiBaseUrl: agentRecord.api_base_url,
            apiKey: agentRecord.api_key,
            modelName: agentRecord.model_name,
          }, abortController.signal)) {
            full += token;
            setStreamContents(prev => ({ ...prev, [agentId]: full }));
          }

          await updateMessage(messageId, { content: full });
        } finally {
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
    try {
      const roundId = roundDetail.current_round.id;

      await ensureBridgeRoom(roundDetail.agents_attached);

      for (const agentId of agentIds) {
        const saRecords = await getSessionAgents(sessionId);
        const sa = saRecords.find(s => s.generated_agent_id === agentId || s.agent_id === agentId);
        const agentRecord = await getAgent(sa?.agent_id ?? agentId);
        if (!agentRecord) continue;

        const agentName = roundDetail.agents_attached.find(a => a.id === agentId)?.name || '';
        if (!agentName) continue;

        const tid = await createThread({ round_id: roundId, agent_id: agentId });
        await createThreadMessage({ thread_id: tid, is_human: true, content: question });
        const tmid = await createThreadMessage({ thread_id: tid, is_human: false, content: '' });

        const abortController = new AbortController();
        abortRef.current = abortController;

        setStreamingAgentIds(prev => new Set(prev).add(agentId));
        setStreamContents(prev => ({ ...prev, [agentId]: '' }));

        (async () => {
          try {
            let full = '';
            for await (const token of streamChat(sessionId, agentName, question, {
              apiBaseUrl: agentRecord.api_base_url,
              apiKey: agentRecord.api_key,
              modelName: agentRecord.model_name,
            }, abortController.signal)) {
              full += token;
              setStreamContents(prev => ({ ...prev, [agentId]: full }));
            }
            await updateThreadMessage(tmid, { content: full });
          } finally {
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

      const freshDetail = await buildDetail(sessionId, roundDetail.current_round.round_number);
      setRoundDetail(freshDetail);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleEndRound = async () => {
    if (!roundDetail) return;
    setLoading(true);
    try {
      const roundId = roundDetail.current_round.id;
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

      const abortController = new AbortController();
      abortRef.current = abortController;

      let summary = '';
      setStreamingScribeContent('');
      for await (const token of streamScribeSummary(sessionId, [{ name: 'Discussion', content: discussionText }], abortController.signal)) {
        summary += token;
        setStreamingScribeContent(summary);
      }

      await updateRound(roundId, { scribe_summary: summary });
      setStreamingScribeContent(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const handleEndSession = async () => {
    if (!roundDetail) return '';
    try {
      const rounds = await getRounds(sessionId);
      const summaries = rounds.filter(r => r.scribe_summary).map(r =>
        `## Round ${r.round_number}\n${r.scribe_summary}`
      ).join('\n\n');

      const abortController = new AbortController();
      abortRef.current = abortController;

      let report = '';
      setStreamingScribeContent('');
      for await (const token of streamScribeSummary(sessionId, [{ name: 'All Rounds', content: summaries }], abortController.signal)) {
        report += token;
        setStreamingScribeContent(report);
      }

      await updateSession(sessionId, { status: 'completed' });
      setStreamingScribeContent(null);

      // Clean up bridge room
      try {
        await deleteRoom(sessionId);
      } catch { /* ignore cleanup errors */ }
      roomCreatedRef.current = false;

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
    try {
      await deleteRoom(sessionId);
    } catch { /* ignore */ }
    roomCreatedRef.current = false;
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
    roundDetail, loading, error,
    streamingAgentIds, streamContents, isStreaming, streamingScribeContent,
    handleCreateRound, handleStartDivergent, handleStartNextRound,
    handleEndRound, handleMention, handleEndSession,
    handleDeleteSession, fetchSummaries,
  };
}
