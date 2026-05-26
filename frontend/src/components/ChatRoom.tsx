import { useState, useEffect, useRef } from 'react'
import { db } from '../db/db'
import { getRounds, getRoundMessages, getSessionAgents } from '../db/helpers'
import MessageBubble from './MessageBubble'

import RoundDivider from './RoundDivider'
import AgentStatusBar from './AgentStatusBar'
import type { RoundDetailType } from '../types'

interface RoundHistory {
  round_number: number;
  scribe_summary: string;
  messages: { agent_name: string; content: string; is_human: boolean }[];
}

interface Props {
  sessionId: number;
  roundDetail: RoundDetailType | null;
  onSendMention: (agentIds: number[], question: string) => void;
  onCreateRound: (initialMessage: string) => void;
  onStartDivergent: () => void;
  onStartNextRound: () => void;
  onEndRound: () => void;
  loading: boolean;
  pendingRoundInput?: boolean;
  streamingAgentIds?: Set<number>;
  streamContents?: Record<number, string>;
  isStreaming?: boolean;
  streamingScribeContent?: string | null;
}

export default function ChatRoom({
  sessionId, roundDetail, onSendMention, onCreateRound, onStartDivergent,
  onStartNextRound, onEndRound, loading, pendingRoundInput,
  streamingAgentIds, streamContents, isStreaming, streamingScribeContent,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [mentionText, setMentionText] = useState('')
  const [selectedAgentIds, setSelectedAgentIds] = useState<number[]>([])
  const [initialContext, setInitialContext] = useState('')
  const [nextRoundContext, setNextRoundContext] = useState('')
  const [history, setHistory] = useState<RoundHistory[]>([])
  const [expandedRound, setExpandedRound] = useState<number | null>(null)

  // Load previous rounds when roundDetail changes
  useEffect(() => {
    if (!roundDetail) return
    const currentNum = roundDetail.current_round.round_number
    if (currentNum <= 1) { setHistory([]); return }

    ;(async () => {
      const [rounds, saRecords] = await Promise.all([
        getRounds(sessionId),
        getSessionAgents(sessionId),
      ])
      const genAgentIds = saRecords.filter(sa => sa.generated_agent_id != null).map(sa => sa.generated_agent_id!)
      const genAgents = genAgentIds.length > 0 ? await db.generatedAgents.bulkGet(genAgentIds) : []
      const genNameMap = new Map(genAgents.filter(Boolean).map(a => [a!.id!, a!.name]))
      const presetAgentIds = [...new Set(saRecords.map(sa => sa.agent_id))]
      const presetAgents = presetAgentIds.length > 0 ? await db.agents.bulkGet(presetAgentIds) : []
      const presetNameMap = new Map(presetAgents.filter(Boolean).map(a => [a!.id!, a!.name]))

      function agentName(mid: number): string {
        const sa = saRecords.find(s => s.generated_agent_id === mid)
        if (sa)       return genNameMap.get(mid) || '未知'
        return presetNameMap.get(mid) || '未知'
      }

      const prev: RoundHistory[] = []
      for (const r of rounds) {
        if (r.round_number >= currentNum) continue
        const msgs = await getRoundMessages(r.id!)
        prev.push({
          round_number: r.round_number,
          scribe_summary: r.scribe_summary || '',
          messages: msgs.map(m => ({
            agent_name: m.is_human ? '用户' : (m.agent_id != null ? agentName(m.agent_id) : ''),
            content: m.content,
            is_human: m.is_human,
          })),
        })
      }
      setHistory(prev)
    })()
  }, [roundDetail, sessionId])

  const toggleAgent = (id: number) => {
    setSelectedAgentIds(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    )
  }

  const selectAll = () => {
    setSelectedAgentIds(prev =>
      prev.length === nonScribeAgents.length ? [] : nonScribeAgents.map(a => a.id)
    )
  }

  const sendMention = () => {
    if (selectedAgentIds.length > 0 && mentionText.trim() && !isStreaming) {
      onSendMention(selectedAgentIds, mentionText.trim())
      setMentionText('')
      setSelectedAgentIds([])
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [roundDetail, streamContents])

  // State A: No round yet — show initial context input
  if (!roundDetail) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', gap: 12, maxWidth: 600, margin: '0 auto',
      }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 15, textAlign: 'center' }}>
            输入初始上下文，开始头脑风暴讨论。
          </p>
          <textarea
            value={initialContext}
            onChange={e => setInitialContext(e.target.value)}
            placeholder="描述你希望各角色讨论的话题或问题..."
          rows={4}
          style={{
            width: '100%', padding: 12, border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', fontSize: 14, outline: 'none',
            resize: 'vertical', fontFamily: 'inherit',
          }}
        />
        <button
          onClick={() => { onCreateRound(initialContext); setInitialContext('') }}
          disabled={loading || !initialContext.trim()}
          style={{
            padding: '10px 28px',
            background: loading || !initialContext.trim() ? '#D1D5DB' : 'var(--primary)',
            color: '#fff', border: 'none', borderRadius: 'var(--radius)',
            cursor: loading || !initialContext.trim() ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 500,
          }}>
          {loading ? '发送中...' : '发送'}
        </button>
      </div>
    )
  }

  const { current_round, agents_attached } = roundDetail
  const nonScribeAgents = agents_attached.filter(a => !a.is_scribe)
  const hasDivergentStarted = current_round.public_messages.some(m => !m.is_human)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <AgentStatusBar
        agents={agents_attached}
        streamingAgentIds={streamingAgentIds}
      />

      {/* Streaming banner */}
      {isStreaming && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', marginBottom: 12, flexShrink: 0,
          background: 'var(--accent-light)', borderRadius: 'var(--radius)',
          border: '1px solid var(--primary-border)',
          fontSize: 13, color: 'var(--accent)', fontWeight: 500,
        }}>
          <span className="thinking-dots">
            <span className="thinking-dot" />
            <span className="thinking-dot" />
            <span className="thinking-dot" />
          </span>
          各角色正在生成回复...
        </div>
      )}

      {/* Scrollable message area - fills remaining space */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)',
        padding: 16, marginBottom: 12,
      }}>
        {/* Previous rounds — collapsible history */}
        {history.map(h => (
          <div key={h.round_number} style={{ marginBottom: 16 }}>
            <div onClick={() => setExpandedRound(expandedRound === h.round_number ? null : h.round_number)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', background: 'var(--bg)',
                borderRadius: 'var(--radius)', cursor: 'pointer',
                border: '1px solid var(--border)', userSelect: 'none',
              }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                {expandedRound === h.round_number ? '▼' : '▶'} 第 {h.round_number} 轮
              </span>
              {h.scribe_summary && (
                <span style={{
                  fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                }}>
                  {h.scribe_summary.slice(0, 80)}...
                </span>
              )}
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {h.messages.filter(m => !m.is_human).length} 条回复
              </span>
            </div>

            {expandedRound === h.round_number && (
              <div style={{ marginTop: 8 }}>
                {h.messages.filter(m => m.content).map((m, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: m.is_human ? 'var(--accent)' : 'var(--primary)', marginBottom: 2 }}>
                      {m.agent_name}
                    </div>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {h.scribe_summary && (
                  <div style={{
                    marginTop: 8, padding: 10, background: 'var(--primary-light)',
                    borderRadius: 'var(--radius)', borderLeft: '3px solid var(--primary)', fontSize: 13,
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--primary)', marginBottom: 4 }}>书记官总结</div>
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{h.scribe_summary}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        <RoundDivider roundNumber={current_round.round_number} />

        {/* Public messages */}
        {current_round.public_messages.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40, fontSize: 14 }}>
            等待各角色回复...
          </p>
        ) : (
          current_round.public_messages.map(m => (
            <div key={m.id}>
              <MessageBubble
                message={m}
                isHuman={m.is_human}
                streamingContent={m.agent_id !== null ? streamContents?.[m.agent_id] : undefined}
              />
            </div>
          ))
        )}

        {/* Private threads */}
        {current_round.private_threads.map(t => (
          <div key={t.id} style={{
            marginLeft: 24, borderLeft: '3px solid var(--accent)', paddingLeft: 12,
            marginBottom: 16, marginTop: 16,
          }}>
            <div style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 8, fontWeight: 500 }}>
              与 {t.agent_name} 的私密对话
            </div>
            {t.messages.map(tm => (
              <div key={tm.id}>
                <MessageBubble message={{
                  id: tm.id, agent_id: null,
                  agent_name: tm.is_human ? '你' : t.agent_name,
                  is_human: tm.is_human, content: tm.content, created_at: tm.created_at,
                }} isHuman={tm.is_human}
                  streamingContent={!tm.is_human ? streamContents?.[t.agent_id] : undefined} />
              </div>
            ))}
          </div>
        ))}

        {/* Scribe summary */}
        {(current_round.scribe_summary || streamingScribeContent) && (
          <div style={{
            marginTop: 16, padding: 14, background: 'var(--primary-light)',
            borderRadius: 'var(--radius)', borderLeft: '3px solid var(--primary)',
          }}>
            <div style={{ fontSize: 12, color: 'var(--primary)', marginBottom: 6, fontWeight: 600 }}>
              {streamingScribeContent ? '书记官正在总结...' : '书记官总结'}
            </div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: 'var(--text-primary)', lineHeight: 1.6 }}>
              {streamingScribeContent || current_round.scribe_summary}
            </div>
          </div>
        )}

        {/* State B: Round created but divergent not started yet */}
        {!hasDivergentStarted && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 12, padding: 40,
          }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, textAlign: 'center' }}>
              初始上下文已提交。准备开始角色讨论？
            </p>
            <button onClick={onStartDivergent} disabled={loading || isStreaming}
              style={{
                padding: '10px 28px',
                background: loading || isStreaming ? '#D1D5DB' : 'var(--primary)',
                color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                cursor: loading || isStreaming ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 500,
              }}>
              {loading || isStreaming ? '启动中...' : '开始角色讨论'}
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Pending round input — user speaks before next round */}
      {pendingRoundInput && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 12, padding: 24, flexShrink: 0,
        }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, textAlign: 'center' }}>
            请输入第 {current_round.round_number + 1} 轮的讨论方向...
          </p>
          <textarea
            value={nextRoundContext}
            onChange={e => setNextRoundContext(e.target.value)}
            placeholder="描述你希望各角色在本轮讨论的话题..."
            rows={3}
            style={{
              width: '100%', padding: 12, border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', fontSize: 14, outline: 'none',
              resize: 'vertical', fontFamily: 'inherit',
            }}
          />
          <button
            onClick={() => { onCreateRound(nextRoundContext); setNextRoundContext('') }}
            disabled={loading || !nextRoundContext.trim()}
            style={{
              padding: '10px 28px',
              background: loading || !nextRoundContext.trim() ? '#D1D5DB' : 'var(--primary)',
              color: '#fff', border: 'none', borderRadius: 'var(--radius)',
              cursor: loading || !nextRoundContext.trim() ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 500,
            }}>
            {loading ? '发送中...' : '发送'}
          </button>
        </div>
      )}

      {/* State C: Full controls — only after divergent has started */}
      {hasDivergentStarted && !pendingRoundInput && (
        <>
          {/* @mention area — multi-select pills + text input */}
          <div style={{ marginBottom: 12, flexShrink: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {nonScribeAgents.map(a => {
                const sel = selectedAgentIds.includes(a.id)
                return (
                  <label key={a.id} style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '4px 12px', borderRadius: 'var(--radius-full)',
                    background: sel ? 'var(--primary)' : 'var(--bg)',
                    color: sel ? '#fff' : 'var(--text-primary)',
                    border: sel ? 'none' : '1px solid var(--border)',
                    cursor: isStreaming ? 'not-allowed' : 'pointer',
                    fontSize: 13, userSelect: 'none', opacity: isStreaming ? 0.5 : 1,
                    transition: 'all 0.15s',
                  }}>
                    <input type="checkbox" checked={sel}
                      onChange={() => toggleAgent(a.id)}
                      disabled={!!isStreaming}
                      style={{ display: 'none' }} />
                    {a.name}
                  </label>
                )
              })}
              <button onClick={selectAll} disabled={!!isStreaming}
                style={{
                  padding: '4px 12px', borderRadius: 'var(--radius-full)',
                  background: selectedAgentIds.length === nonScribeAgents.length ? 'var(--accent)' : 'var(--accent-light)',
                  color: selectedAgentIds.length === nonScribeAgents.length ? '#fff' : 'var(--accent)',
                  border: '1px solid var(--primary-border)', fontSize: 13,
                  cursor: isStreaming ? 'not-allowed' : 'pointer', opacity: isStreaming ? 0.5 : 1,
                }}>
                {selectedAgentIds.length === nonScribeAgents.length ? '取消全选' : '@全部'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={mentionText} onChange={e => setMentionText(e.target.value)}
                disabled={!!isStreaming}
                onKeyDown={e => {
                  if (e.key === 'Enter' && selectedAgentIds.length > 0 && mentionText.trim() && !isStreaming) {
                    sendMention()
                  }
                }}
                placeholder={isStreaming ? '等待回复中...' : '追问...'}
                style={{
                  flex: 1, padding: '8px 12px', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', fontSize: 14, outline: 'none',
                  background: 'var(--surface)', color: 'var(--text-primary)',
                  opacity: isStreaming ? 0.5 : 1,
                }}
              />
              <button onClick={sendMention}
                disabled={!!isStreaming || selectedAgentIds.length === 0 || !mentionText.trim()}
                style={{
                  padding: '8px 20px',
                  background: isStreaming || selectedAgentIds.length === 0 || !mentionText.trim()
                    ? '#D1D5DB' : 'var(--accent)',
                  color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                  cursor: isStreaming || selectedAgentIds.length === 0 || !mentionText.trim()
                    ? 'not-allowed' : 'pointer',
                  fontSize: 14, fontWeight: 500, flexShrink: 0,
                }}>
                @发送
              </button>
            </div>
          </div>

          {/* Round controls */}
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={onEndRound} disabled={loading || !!isStreaming}
              style={{
                padding: '8px 20px',
                background: loading || isStreaming ? '#D1D5DB' : 'var(--accent)',
                color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                cursor: loading || isStreaming ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 500,
              }}>
              结束本轮并总结
            </button>
          </div>
        </>
      )}
    </div>
  )
}
