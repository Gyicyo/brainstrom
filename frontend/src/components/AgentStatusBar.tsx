interface AgentInfo {
  id: number;
  name: string;
  is_scribe: boolean;
}

interface Props {
  agents: AgentInfo[];
  respondingAgentId?: number | null;
}

export default function AgentStatusBar({ agents, respondingAgentId }: Props) {
  const nonScribe = agents.filter(a => !a.is_scribe)

  return (
    <div style={{
      display: 'flex', gap: 8, padding: '8px 12px',
      background: '#fafafa', borderRadius: 8, marginBottom: 16,
      flexWrap: 'wrap',
    }}>
      {nonScribe.map(a => {
        const isResponding = a.id === respondingAgentId
        return (
          <div key={a.id} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 12, fontSize: 12,
            background: isResponding ? '#fff3e0' : '#f0f0f0',
            color: isResponding ? '#e65100' : '#666',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: isResponding ? '#ff9800' : '#4caf50',
              display: 'inline-block',
            }} />
            {a.name}
            {isResponding && ' (responding...)'}
          </div>
        )
      })}
    </div>
  )
}
