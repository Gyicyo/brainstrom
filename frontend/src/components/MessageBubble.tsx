import AgentAvatar from './AgentAvatar'
import type { MessageType } from '../types'

interface Props {
  message: MessageType;
  isHuman?: boolean;
}

export default function MessageBubble({ message, isHuman }: Props) {
  const align = isHuman ? 'flex-end' : 'flex-start'
  const bubbleBg = isHuman ? '#1976d2' : '#fff'
  const textColor = isHuman ? '#fff' : '#333'
  const border = isHuman ? 'none' : '1px solid #e0e0e0'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexDirection: isHuman ? 'row-reverse' : 'row' }}>
        <AgentAvatar name={isHuman ? 'You' : message.agent_name} isHuman={isHuman} size={36} />
        <div style={{
          maxWidth: '70%', padding: '10px 14px', borderRadius: 12,
          background: bubbleBg, color: textColor, border, fontSize: 14, lineHeight: 1.5,
        }}>
          {message.content}
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#999', marginTop: 4, paddingLeft: 44 }}>
        {message.agent_name}{isHuman ? ' (You)' : ''} · {new Date(message.created_at).toLocaleTimeString()}
      </div>
    </div>
  )
}
