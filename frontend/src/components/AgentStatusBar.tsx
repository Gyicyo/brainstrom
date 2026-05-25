interface AgentInfo {
  id: number;
  name: string;
  is_scribe: boolean;
}

interface Props {
  agents: AgentInfo[];
  streamingAgentIds?: Set<number>;
}

export default function AgentStatusBar({ agents, streamingAgentIds }: Props) {
  const nonScribe = agents.filter(a => !a.is_scribe)

  return (
    <div style={{
      display: 'flex', gap: 8, padding: '10px 12px',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', marginBottom: 16,
      flexWrap: 'wrap', minHeight: 20,
    }}>
      {nonScribe.map(a => {
        const isStreaming = streamingAgentIds?.has(a.id)
        const active = isStreaming
        return (
          <div key={a.id} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 12,
            background: active ? 'var(--accent-light)' : 'var(--bg)',
            color: active ? 'var(--accent)' : 'var(--text-secondary)',
            transition: 'all 0.15s',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: active ? 'var(--accent)' : 'var(--success)',
              display: 'inline-block',
              transition: 'background 0.15s',
            }} />
            {a.name}
            {isStreaming && (
              <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 2 }}>
                <span className="thinking-dots" style={{ gap: 2 }}>
                  <span className="thinking-dot" style={{ width: 4, height: 4 }} />
                  <span className="thinking-dot" style={{ width: 4, height: 4 }} />
                  <span className="thinking-dot" style={{ width: 4, height: 4 }} />
                </span>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
