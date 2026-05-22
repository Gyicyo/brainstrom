import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listSessions, createSession, listAgents } from '../api/client'
import type { SessionType, AgentType } from '../types'

export default function Dashboard() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionType[]>([])
  const [agents, setAgents] = useState<AgentType[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [topic, setTopic] = useState('')
  const [selectedAgents, setSelectedAgents] = useState<number[]>([])

  const load = async () => {
    try {
      setSessions(await listSessions())
      setAgents(await listAgents())
    } catch (e) {
      console.error('Failed to load data', e)
    }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!topic.trim() || selectedAgents.length === 0) return
    const session = await createSession({ topic, agent_ids: selectedAgents })
    setShowCreate(false)
    setTopic('')
    setSelectedAgents([])
    navigate(`/session/${session.id}`)
  }

  const toggleAgent = (id: number) => {
    setSelectedAgents(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Sessions</h1>
        <button onClick={() => setShowCreate(true)}
          style={{ padding: '8px 16px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          + New Session
        </button>
      </div>

      {showCreate && (
        <div style={{ background: '#fff', padding: 24, borderRadius: 8, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 12px' }}>Create New Brainstorm Session</h3>
          <input
            placeholder="Enter brainstorming topic..."
            value={topic}
            onChange={e => setTopic(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 4, marginBottom: 16, boxSizing: 'border-box' }}
          />
          <p style={{ margin: '0 0 8px', fontWeight: 500 }}>Select Agents:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {agents.map(a => (
              <label key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 16,
                background: selectedAgents.includes(a.id) ? '#1976d2' : '#eee',
                color: selectedAgents.includes(a.id) ? '#fff' : '#333',
                cursor: 'pointer', fontSize: 14,
              }}>
                <input type="checkbox" checked={selectedAgents.includes(a.id)}
                  onChange={() => toggleAgent(a.id)} style={{ display: 'none' }} />
                {a.name}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleCreate}
              style={{ padding: '8px 16px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              Start Session
            </button>
            <button onClick={() => setShowCreate(false)}
              style={{ padding: '8px 16px', background: '#eee', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {sessions.length === 0 ? (
        <p style={{ color: '#999', textAlign: 'center', padding: 48 }}>No sessions yet. Create one to get started!</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sessions.map(s => (
            <div key={s.id} onClick={() => navigate(`/session/${s.id}`)}
              style={{
                background: '#fff', padding: 16, borderRadius: 8, cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between',
              }}>
              <div>
                <strong>{s.topic || '(No topic)'}</strong>
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                  Round {s.current_round} · {s.status}
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#999' }}>
                {new Date(s.created_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
