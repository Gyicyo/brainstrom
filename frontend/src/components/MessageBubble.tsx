import { useState } from 'react'
import AgentAvatar from './AgentAvatar'
import type { MessageType } from '../types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

interface Props {
  message: MessageType;
  isHuman?: boolean;
  streamingContent?: string;
}

export default function MessageBubble({ message, isHuman, streamingContent }: Props) {
  const [expanded, setExpanded] = useState(false)

  const align = isHuman ? 'flex-end' : 'flex-start'
  const border = isHuman ? '2px solid var(--bubble-human-border)' : '1px solid var(--bubble-ai-border)'

  // Streaming state: no tokens yet — show thinking indicator
  const isThinking = streamingContent !== undefined && streamingContent === '' && !message.content
  // Streaming state: has partial tokens — show them
  const displayContent = streamingContent !== undefined ? streamingContent : message.content

  const firstLine = displayContent.split('\n')[0]
  const isTruncatable = displayContent.length > 120 || displayContent !== firstLine
  const preview = firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine
  const showEllipsis = isTruncatable && !expanded && streamingContent === undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexDirection: isHuman ? 'row-reverse' : 'row' }}>
        <AgentAvatar name={isHuman ? 'You' : message.agent_name} isHuman={isHuman} size={34} />
        <div style={{
          maxWidth: '80%', padding: '10px 14px', borderRadius: 'var(--radius-lg)',
          background: 'var(--bubble-ai-bg)', color: 'var(--text-primary)',
          border, fontSize: 14, lineHeight: 1.6,
          boxShadow: 'var(--bubble-shadow)',
          wordBreak: 'break-word',
          minHeight: isThinking ? 40 : undefined,
          display: 'flex', alignItems: isThinking ? 'center' : undefined,
        }}>
          {isThinking ? (
            <span className="thinking-dots">
              <span className="thinking-dot" />
              <span className="thinking-dot" />
              <span className="thinking-dot" />
              <span style={{ marginLeft: 6, fontSize: 13, color: 'var(--text-muted)' }}>
                thinking...
              </span>
            </span>
          ) : streamingContent !== undefined ? (
            displayContent || ' '
          ) : (
              <div className="message-content" style={{ maxWidth: '100%', overflowX: 'auto' }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                >
                  {expanded ? message.content : (showEllipsis ? `${preview}...` : message.content)}
                </ReactMarkdown>
                {showEllipsis && (
                  <div style={{
                    marginTop: 8, fontSize: 12, color: 'var(--primary)', fontWeight: 500,
                    display: 'flex', alignItems: 'center', gap: 4,
                    cursor: 'pointer',
                  }} onClick={(e) => { e.stopPropagation(); setExpanded(true) }}>
                    Click to expand <span>▼</span>
                  </div>
                )}
              </div>
          )}
        </div>
      </div>
      <div style={{
        fontSize: 11, color: 'var(--text-muted)', marginTop: 4,
        paddingLeft: 42, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span>{message.agent_name}{isHuman ? ' (You)' : ''} · {new Date(message.created_at).toLocaleTimeString()}</span>
        {expanded && isTruncatable && streamingContent === undefined && (
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
