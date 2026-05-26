import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../db/db';
import {
  getSession, getCurrentRound, getRoundMessages, getRoundThreads, getThreadMessages,
  getSessionAgents, getAgent, createRound, createMessage, updateMessage,
  updateRound, createThread, createThreadMessage, updateThreadMessage,
  getRounds, updateSession,
  deleteSession as deleteSessionFromDb,
} from '../db/helpers';
import { streamChat, streamScribeSummary, createRoom, deleteRoom, resumeRoom } from '../llm/bridgeApi';
import { buildDivergentContext } from '../llm/prompt';
import { loadLLMConfig } from '../pages/LLMConfig';
import type { RoundDetailType } from '../types';

function getGlobalApiConfig() {
  const c = loadLLMConfig();
  return { apiBaseUrl: c.baseUrl, apiKey: c.apiKey, modelName: c.modelName };
}

export function useSession(sessionId: number) {
  const [roundDetail, setRoundDetail] = useState<RoundDetailType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingAgentIds, setStreamingAgentIds] = useState<Set<number>>(new Set());
  const [streamContents, setStreamContents] = useState<Record<number, string>>({});
  const [streamingScribeContent, setStreamingScribeContent] = useState<string | null>(null);
  const [pendingRoundInput, setPendingRoundInput] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const syncedRef = useRef(false);

  useEffect(() => {
    syncedRef.current = false;
    return () => { abortRef.current?.abort(); };
  }, [sessionId]);

  const isStreaming = streamingAgentIds.size > 0;

  async function buildRoundDetail(
    session: { id?: number; topic: string; status: string; current_round: number; created_at: string },
    round: { id?: number; session_id: number; round_number: number; scribe_summary: string; created_at: string },
  ): Promise<RoundDetailType> {
    const rid = round.id!;
    const sid = session.id!;

    const saRecords = await getSessionAgents(sid);
    const generatedAgentIds = saRecords.filter(sa => sa.generated_agent_id != null).map(sa => sa.generated_agent_id!);
    const genAgents = generatedAgentIds.length > 0 ? await db.generatedAgents.bulkGet(generatedAgentIds) : [];
    const genAgentMap = new Map(genAgents.filter(Boolean).map(a => [a!.id!, a!]));
    const agentsAttached: { id: number; name: string; is_scribe: boolean }[] = [];
    for (const sa of saRecords) {
      if (sa.generated_agent_id != null) {
        const genAgent = genAgentMap.get(sa.generated_agent_id);
        if (genAgent) agentsAttached.push({ id: genAgent.id!, name: genAgent.name, is_scribe: sa.is_scribe });
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
      const detail = await buildRoundDetail(session, round);
      setRoundDetail(detail);
      if (!syncedRef.current && session.status === 'active' && detail.agents_attached.length > 0) {
        syncedRef.current = true;
        ensureBridgeRoom(detail.agents_attached).catch(() => {});
      }
    } catch {
      setRoundDetail(null);
    }
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  async function ensureBridgeRoom(agents: { id: number; name: string; is_scribe: boolean }[]) {
    const session = await getSession(sessionId);
    if (!session) throw new Error('未找到会话');

    const saRecords = await getSessionAgents(sessionId);
    const agentConfigs: { name: string; skillContent: string }[] = [];

    for (const a of agents) {
      const sa = saRecords.find(s => s.generated_agent_id === a.id || s.agent_id === a.id);
      let skillContent = '';
      if (sa?.generated_agent_id != null) {
        const genAgent = await db.generatedAgents.get(sa.generated_agent_id);
        if (genAgent) skillContent = genAgent.system_prompt || '';
      }
      agentConfigs.push({ name: a.name, skillContent });
    }

    const apiConfig = getGlobalApiConfig();

    // Try resume first (pi session already persisted on disk), fall back to create
    const resumed = await resumeRoom(sessionId);
    if (!resumed.ok) {
      await createRoom(sessionId, session.topic, agentConfigs, apiConfig);
    }
  }

  const handleCreateRound = async (initialMessage: string) => {
    setLoading(true);
    setPendingRoundInput(false);
    try {
      const session = await getSession(sessionId);
      if (!session) throw new Error('未找到会话');

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

      await ensureBridgeRoom(roundDetail.agents_attached);

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

      const freshDetail = await buildDetail(sessionId, roundDetail.current_round.round_number);
      setRoundDetail(freshDetail);

      const agentIds = nonScribeAgents.map(a => a.id);
      setStreamingAgentIds(new Set(agentIds));
      setStreamContents(Object.fromEntries(agentIds.map(id => [id, ''])));

      const abortController = new AbortController();
      abortRef.current = abortController;

      const divergentContext = await buildDivergentContext(sessionId, roundDetail.current_round.round_number, roundId);
      const userMessage = divergentContext || roundDetail.session.topic;

      const promises = entries.map(async ({ agentId, agentName, messageId }) => {
        try {
          let full = '';
          for await (const token of streamChat(sessionId, agentName, userMessage, abortController.signal)) {
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
        const agentName = roundDetail.agents_attached.find(a => a.id === agentId)?.name || '';
        if (!agentName) continue;

        const tid = await createThread({ round_id: roundId, agent_id: agentId });
        await createThreadMessage({ thread_id: tid, is_human: true, content: question });
        const tmid = await createThreadMessage({ thread_id: tid, is_human: false, content: '' });

        const abortController = new AbortController();
        abortRef.current = abortController;

        setStreamingAgentIds(prev => new Set(prev).add(agentId));
        setStreamContents(prev => ({ ...prev, [agentId]: '' }));

        const mentionContext = await buildDivergentContext(sessionId, roundDetail.current_round.round_number, roundId);
        const fullQuestion = mentionContext ? `${mentionContext}\n\n【追问】\n${question}` : question;

        (async () => {
          try {
            let full = '';
            for await (const token of streamChat(sessionId, agentName, fullQuestion, abortController.signal)) {
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
        const name = m.is_human ? '用户'
          : roundDetail?.agents_attached.find(a => a.id === m.agent_id)?.name || '未知';
        return `${name}: ${m.content}`;
      }).join('\n\n');

      for (const t of threads) {
        const tms = await getThreadMessages(t.id!);
        const agentName = roundDetail?.agents_attached.find(a => a.id === t.agent_id)?.name || '未知';
        discussionText += '\n\n' + tms.map(tm => {
          const name = tm.is_human ? '用户' : agentName;
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
      setPendingRoundInput(true);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const handleEndSession = async () => {
    const session = await getSession(sessionId);
    if (!session) { setError('Session not found'); return ''; }

    try {
      const rounds = await getRounds(sessionId);
      const summaryText = rounds
        .filter(r => r.scribe_summary)
        .map(r => `Round ${r.round_number}:\n${r.scribe_summary}`)
        .join('\n\n');

      let report = '';
      setStreamingScribeContent('');
      for await (const token of streamScribeSummary(sessionId, [
        { name: 'Session Summary', content: `总结整个头脑风暴会话并生成最终报告。\n\n${summaryText}` },
      ])) {
        report += token;
        setStreamingScribeContent(report);
      }
      if (!report) report = '已完成。';
      await updateSession(sessionId, { status: 'completed' });
      setStreamingScribeContent(null);

      try { await deleteRoom(sessionId); } catch { /* ignore */ }

      return report;
    } catch (e: any) {
      setError(e.message);
      return '';
    }
  };

  const handleStartNextRound = async () => {
    setPendingRoundInput(true);
  };

  const handleDeleteSession = async () => {
    try { await deleteRoom(sessionId); } catch { /* ignore */ }
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
    roundDetail, loading, error, pendingRoundInput,
    streamingAgentIds, streamContents, isStreaming, streamingScribeContent,
    handleCreateRound, handleStartDivergent, handleStartNextRound,
    handleEndRound, handleMention, handleEndSession,
    handleDeleteSession, fetchSummaries,
  };
}
