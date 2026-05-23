import { useState } from 'react'

interface GeneratedAgent {
  name: string
  personality: string
  system_prompt: string
}

interface Props {
  agents: GeneratedAgent[]
  loading: boolean
  onEdit: (index: number, updates: Partial<GeneratedAgent>) => void
  onRegenerate: (index: number) => void
  onRegenerateAll: () => void
  onStart: () => void
}

export default function GeneratedAgentList({
  agents, loading, onEdit, onRegenerate, onRegenerateAll, onStart,
}: Props) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          Generated Agents ({agents.length})
        </h3>
        <button onClick={onRegenerateAll} disabled={loading}
          style={{
            padding: '6px 16px', background: loading ? '#D1D5DB' : 'var(--bg)',
            color: 'var(--text-secondary)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 500,
          }}>
          {loading ? 'Generating...' : 'Regenerate All'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {agents.map((agent, i) => (
          <div key={i} style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: '12px 16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <input
                  value={agent.name}
                  onChange={e => onEdit(i, { name: e.target.value })}
                  style={{
                    fontWeight: 600, fontSize: 15, border: 'none',
                    background: 'transparent', outline: 'none', width: '100%',
                    color: 'var(--text-primary)',
                  }}
                />
                <textarea
                  value={agent.personality}
                  onChange={e => onEdit(i, { personality: e.target.value })}
                  rows={1}
                  style={{
                    fontSize: 13, color: 'var(--text-secondary)', marginTop: 4,
                    border: 'none', background: 'transparent', outline: 'none',
                    width: '100%', resize: 'none', fontFamily: 'inherit',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                <button onClick={() => onRegenerate(i)} disabled={loading}
                  style={{
                    padding: '4px 10px', background: 'var(--bg)',
                    color: 'var(--text-secondary)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', cursor: loading ? 'not-allowed' : 'pointer',
                    fontSize: 12, opacity: loading ? 0.5 : 1,
                  }}>
                  Regenerate
                </button>
                <button onClick={() => setExpanded(prev => ({ ...prev, [i]: !prev[i] }))}
                  style={{
                    padding: '4px 10px', background: 'var(--bg)',
                    color: 'var(--text-secondary)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12,
                  }}>
                  {expanded[i] ? '▲ Hide Prompt' : '▼ Show Prompt'}
                </button>
              </div>
            </div>
            {expanded[i] && (
              <textarea
                value={agent.system_prompt}
                onChange={e => onEdit(i, { system_prompt: e.target.value })}
                rows={4}
                style={{
                  marginTop: 8, width: '100%', padding: '8px 10px',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  fontSize: 13, fontFamily: 'monospace', outline: 'none',
                  background: 'var(--bg)', resize: 'vertical',
                }}
              />
            )}
          </div>
        ))}
      </div>

      <button onClick={onStart} disabled={loading || agents.length === 0}
        style={{
          padding: '10px 28px', width: '100%',
          background: loading || agents.length === 0 ? '#D1D5DB' : 'var(--primary)',
          color: '#fff', border: 'none', borderRadius: 'var(--radius)',
          cursor: loading || agents.length === 0 ? 'not-allowed' : 'pointer',
          fontSize: 14, fontWeight: 500,
        }}>
        {loading ? 'Generating...' : 'Start Session'}
      </button>
    </div>
  )
}
