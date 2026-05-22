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
      display: 'flex', gap: 8, padding: '10px 12px',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', marginBottom: 16,
      flexWrap: 'wrap', minHeight: 20,
    }}>
      {nonScribe.map(a => {
        const isResponding = a.id === respondingAgentId
        return (
          <div key={a.id} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 12,
            background: isResponding ? 'var(--accent-light)' : 'var(--bg)',
            color: isResponding ? 'var(--accent)' : 'var(--text-secondary)',
            transition: 'all 0.15s',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: isResponding ? 'var(--accent)' : 'var(--success)',
              display: 'inline-block',
              transition: 'background 0.15s',
            }} />
            {a.name}
            {isResponding && ' (responding...)'}
          </div>
        )
      })}
    </div>
  )
}
