import AgentAvatar from './AgentAvatar'
import type { MessageType } from '../types'

interface Props {
  message: MessageType;
  isHuman?: boolean;
}

export default function MessageBubble({ message, isHuman }: Props) {
  const align = isHuman ? 'flex-end' : 'flex-start'
  const bubbleBg = isHuman ? 'var(--bubble-human-bg)' : 'var(--bubble-ai-bg)'
  const textColor = isHuman ? '#fff' : 'var(--text-primary)'
  const border = isHuman ? 'none' : '1px solid var(--bubble-ai-border)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexDirection: isHuman ? 'row-reverse' : 'row' }}>
        <AgentAvatar name={isHuman ? 'You' : message.agent_name} isHuman={isHuman} size={34} />
        <div style={{
          maxWidth: '80%', padding: '10px 14px', borderRadius: 'var(--radius-lg)',
          background: bubbleBg, color: textColor, border, fontSize: 14, lineHeight: 1.6,
          boxShadow: isHuman ? 'none' : 'var(--shadow-sm)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {message.content}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, paddingLeft: 42 }}>
        {message.agent_name}{isHuman ? ' (You)' : ''} · {new Date(message.created_at).toLocaleTimeString()}
      </div>
    </div>
  )
}
