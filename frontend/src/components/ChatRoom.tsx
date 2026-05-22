import { useState, useEffect, useRef } from 'react'
import MessageBubble from './MessageBubble'
import RoundDivider from './RoundDivider'
import AgentStatusBar from './AgentStatusBar'
import type { RoundDetailType, MessageType } from '../types'

interface Props {
  roundDetail: RoundDetailType | null;
  onSendMention: (agentId: number, question: string) => void;
  onStartRound: () => void;
  onEndRound: () => void;
  respondingAgentId: number | null;
  loading: boolean;
}

export default function ChatRoom({ roundDetail, onSendMention, onStartRound, onEndRound, respondingAgentId, loading }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [mentionText, setMentionText] = useState('')
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [roundDetail])

  if (!roundDetail) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <p style={{ color: '#999', marginBottom: 16 }}>No active round. Start one to begin brainstorming!</p>
        <button onClick={onStartRound} disabled={loading}
          style={{ padding: '10px 24px', background: loading ? '#ccc' : '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? 'Starting...' : 'Start Round 1'}
        </button>
      </div>
    )
  }

  const { current_round, agents_attached } = roundDetail
  const nonScribeAgents = agents_attached.filter(a => !a.is_scribe)

  const allMessages = current_round.public_messages

  return (
    <div>
      <AgentStatusBar agents={agents_attached} respondingAgentId={respondingAgentId} />

      <div style={{
        background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        minHeight: 400, maxHeight: 500, overflowY: 'auto', padding: 16, marginBottom: 16,
      }}>
        <RoundDivider roundNumber={current_round.round_number} />
        {allMessages.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#999', padding: 40 }}>
            Waiting for agents to respond...
          </p>
        ) : (
          allMessages.map(m => (
            <MessageBubble key={m.id} message={m} />
          ))
        )}

        {current_round.private_threads.map(t => (
          <div key={t.id} style={{ marginLeft: 24, borderLeft: '3px solid #ff9800', paddingLeft: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#ff9800', marginBottom: 8 }}>Private thread with {t.agent_name}</div>
            {t.messages.map(tm => (
              <MessageBubble key={tm.id} message={{
                id: tm.id, agent_id: null, agent_name: tm.is_human ? 'You' : t.agent_name,
                is_human: tm.is_human, content: tm.content, created_at: tm.created_at,
              }} isHuman={tm.is_human} />
            ))}
          </div>
        ))}

        {current_round.scribe_summary && (
          <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Scribe Summary</div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{current_round.scribe_summary}</div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* @mention input */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select value={selectedAgent || ''} onChange={e => setSelectedAgent(Number(e.target.value) || null)}
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4 }}>
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
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4 }}
        />
        <button onClick={() => {
          if (selectedAgent && mentionText.trim()) {
            onSendMention(selectedAgent, mentionText.trim())
            setMentionText('')
          }
        }}
          style={{ padding: '8px 16px', background: '#ff9800', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          @Send
        </button>
      </div>

      {/* Round controls */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onEndRound} disabled={loading}
          style={{ padding: '8px 16px', background: loading ? '#ccc' : '#4caf50', color: '#fff', border: 'none', borderRadius: 4, cursor: loading ? 'not-allowed' : 'pointer' }}>
          End Round & Summarize
        </button>
        <button onClick={onStartRound} disabled={loading}
          style={{ padding: '8px 16px', background: loading ? '#ccc' : '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: loading ? 'not-allowed' : 'pointer' }}>
          Start Next Round
        </button>
      </div>
    </div>
  )
}
