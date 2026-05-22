import { useState } from 'react'
import AgentAvatar from './AgentAvatar'
import type { MessageType } from '../types'

interface Props {
  message: MessageType;
  isHuman?: boolean;
}

export default function MessageBubble({ message, isHuman }: Props) {
  const [expanded, setExpanded] = useState(false)

  const align = isHuman ? 'flex-end' : 'flex-start'
  const border = isHuman ? '2px solid var(--bubble-human-border)' : '1px solid var(--bubble-ai-border)'

  const firstLine = message.content.split('\n')[0]
  const isTruncatable = message.content.length > 120 || message.content !== firstLine
  const preview = firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine
  const showEllipsis = isTruncatable && !expanded

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexDirection: isHuman ? 'row-reverse' : 'row' }}>
        <AgentAvatar name={isHuman ? 'You' : message.agent_name} isHuman={isHuman} size={34} />
        <div style={{
          maxWidth: '80%', padding: '10px 14px', borderRadius: 'var(--radius-lg)',
          background: 'var(--bubble-ai-bg)', color: 'var(--text-primary)',
          border, fontSize: 14, lineHeight: 1.6,
          boxShadow: 'var(--bubble-shadow)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          cursor: showEllipsis ? 'pointer' : 'default',
        }} onClick={() => showEllipsis && setExpanded(true)}>
          {expanded ? message.content : (showEllipsis ? `${preview}...` : message.content)}

          {showEllipsis && (
            <div style={{
              marginTop: 8, fontSize: 12, color: 'var(--primary)', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              Click to expand <span>▼</span>
            </div>
          )}
        </div>
      </div>
      <div style={{
        fontSize: 11, color: 'var(--text-muted)', marginTop: 4,
        paddingLeft: 42, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span>{message.agent_name}{isHuman ? ' (You)' : ''} · {new Date(message.created_at).toLocaleTimeString()}</span>
        {expanded && isTruncatable && (
          <button onClick={(e) => { e.stopPropagation(); setExpanded(false) }}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              fontSize: 11, cursor: 'pointer', padding: 0, textDecoration: 'underline',
            }}>
            ▲ Collapse
          </button>
        )}
      </div>
    </div>
  )
}
