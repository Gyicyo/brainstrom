import { useState, useEffect, useRef } from 'react'
import MessageBubble from './MessageBubble'
import RoundDivider from './RoundDivider'
import AgentStatusBar from './AgentStatusBar'
import type { RoundDetailType } from '../types'

interface Props {
  roundDetail: RoundDetailType | null;
  onSendMention: (agentId: number, question: string) => void;
  onCreateRound: (initialMessage: string) => void;
  onStartDivergent: () => void;
  onStartNextRound: () => void;
  onEndRound: () => void;
  respondingAgentId: number | null;
  loading: boolean;
}

export default function ChatRoom({
  roundDetail, onSendMention, onCreateRound, onStartDivergent,
  onStartNextRound, onEndRound, respondingAgentId, loading,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [mentionText, setMentionText] = useState('')
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null)
  const [initialContext, setInitialContext] = useState('')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [roundDetail])

  // State A: No round yet — show initial context input
  if (!roundDetail) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', gap: 12, maxWidth: 600, margin: '0 auto',
      }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 15, textAlign: 'center' }}>
          Enter initial context to start the brainstorming session.
        </p>
        <textarea
          value={initialContext}
          onChange={e => setInitialContext(e.target.value)}
          placeholder="Describe the topic or question you'd like the agents to discuss..."
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
          {loading ? 'Sending...' : 'Send'}
        </button>
      </div>
    )
  }

  const { current_round, agents_attached } = roundDetail
  const nonScribeAgents = agents_attached.filter(a => !a.is_scribe)
  const hasDivergentStarted = current_round.public_messages.some(m => !m.is_human)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <AgentStatusBar agents={agents_attached} respondingAgentId={respondingAgentId} />

      {/* Scrollable message area - fills remaining space */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)',
        padding: 16, marginBottom: 12,
      }}>
        <RoundDivider roundNumber={current_round.round_number} />

        {/* Public messages */}
        {current_round.public_messages.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40, fontSize: 14 }}>
            Waiting for agents to respond...
          </p>
        ) : (
          current_round.public_messages.map(m => (
            <MessageBubble key={m.id} message={m} isHuman={m.is_human} />
          ))
        )}

        {/* Private threads */}
        {current_round.private_threads.map(t => (
          <div key={t.id} style={{
            marginLeft: 24, borderLeft: '3px solid var(--accent)', paddingLeft: 12,
            marginBottom: 16, marginTop: 16,
          }}>
            <div style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 8, fontWeight: 500 }}>
              Private thread with {t.agent_name}
            </div>
            {t.messages.map(tm => (
              <MessageBubble key={tm.id} message={{
                id: tm.id, agent_id: null, agent_name: tm.is_human ? 'You' : t.agent_name,
                is_human: tm.is_human, content: tm.content, created_at: tm.created_at,
              }} isHuman={tm.is_human} />
            ))}
          </div>
        ))}

        {/* Scribe summary */}
        {current_round.scribe_summary && (
          <div style={{
            marginTop: 16, padding: 14, background: 'var(--primary-light)',
            borderRadius: 'var(--radius)', borderLeft: '3px solid var(--primary)',
          }}>
            <div style={{ fontSize: 12, color: 'var(--primary)', marginBottom: 6, fontWeight: 600 }}>
              Scribe Summary
            </div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: 'var(--text-primary)', lineHeight: 1.6 }}>
              {current_round.scribe_summary}
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
              Initial context submitted. Ready to start the agent discussion?
            </p>
            <button onClick={onStartDivergent} disabled={loading}
              style={{
                padding: '10px 28px',
                background: loading ? '#D1D5DB' : 'var(--primary)',
                color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                cursor: loading ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 500,
              }}>
              {loading ? 'Starting...' : 'Start Agent Discussion'}
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* State C: Full controls — only after divergent has started */}
      {hasDivergentStarted && (
        <>
          {/* @mention input */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexShrink: 0 }}>
            <select value={selectedAgent || ''} onChange={e => setSelectedAgent(Number(e.target.value) || null)}
              style={{
                padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                fontSize: 14, background: 'var(--surface)', color: 'var(--text-primary)',
                minWidth: 160, outline: 'none',
              }}>
              <option value="">@mention an agent...</option>
              {nonScribeAgents.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <input value={mentionText} onChange={e => setMentionText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && selectedAgent && mentionText.trim()) {
                  onSendMention(selectedAgent, mentionText.trim())
                  setMentionText('')
                }
              }}
              placeholder="Ask a follow-up..."
              style={{
                flex: 1, padding: '8px 12px', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', fontSize: 14, outline: 'none',
                background: 'var(--surface)', color: 'var(--text-primary)',
              }}
            />
            <button onClick={() => {
              if (selectedAgent && mentionText.trim()) {
                onSendMention(selectedAgent, mentionText.trim())
                setMentionText('')
              }
            }}
              style={{
                padding: '8px 20px', background: 'var(--accent)', color: '#fff',
                border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
                fontSize: 14, fontWeight: 500, flexShrink: 0,
              }}>
              @Send
            </button>
          </div>

          {/* Round controls */}
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={onEndRound} disabled={loading}
              style={{
                padding: '8px 20px',
                background: loading ? '#D1D5DB' : 'var(--accent)',
                color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                cursor: loading ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 500,
              }}>
              End Round & Summarize
            </button>
            <button onClick={onStartNextRound} disabled={loading}
              style={{
                padding: '8px 20px',
                background: loading ? '#D1D5DB' : 'var(--primary)',
                color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                cursor: loading ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 500,
              }}>
              Start Next Round
            </button>
          </div>
        </>
      )}
    </div>
  )
}
