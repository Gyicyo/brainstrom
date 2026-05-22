import { useEffect, useState } from 'react'
import { listAgents, createAgent, updateAgent, deleteAgent } from '../api/client'
import type { AgentType } from '../types'

const emptyForm = {
  name: '', personality: '', system_prompt: '',
  api_base_url: 'https://api.openai.com/v1', api_key: '', model_name: 'gpt-4o',
  avatar_url: '',
}

export default function AgentConfig() {
  const [agents, setAgents] = useState<AgentType[]>([])
  const [editing, setEditing] = useState<Partial<AgentType> | null>(null)
  const [editId, setEditId] = useState<number | null>(null)

  const load = async () => {
    try { setAgents(await listAgents()) } catch (e) { console.error(e) }
  }
  useEffect(() => { load() }, [])

  const handleSave = async () => {
    if (!editing) return
    try {
      if (editId) {
        await updateAgent(editId, editing)
      } else {
        await createAgent(editing as any)
      }
      setEditing(null)
      setEditId(null)
      load()
    } catch (e) { console.error(e) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this agent?')) return
    try {
      await deleteAgent(id)
      load()
    } catch (e) { console.error(e) }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Agent Configuration</h1>
        <button onClick={() => { setEditing({...emptyForm}); setEditId(null) }}
          style={{ padding: '8px 16px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          + Add Agent
        </button>
      </div>

      {editing && (
        <div style={{ background: '#fff', padding: 24, borderRadius: 8, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 16px' }}>{editId ? 'Edit Agent' : 'New Agent'}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input placeholder="Name" value={editing.name || ''}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4 }} />
            <textarea placeholder="Personality / Role Description" value={editing.personality || ''}
              onChange={e => setEditing({ ...editing, personality: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4, minHeight: 60 }} />
            <textarea placeholder="System Prompt" value={editing.system_prompt || ''}
              onChange={e => setEditing({ ...editing, system_prompt: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4, minHeight: 80 }} />
            <input placeholder="Avatar URL (optional)" value={editing.avatar_url || ''}
              onChange={e => setEditing({ ...editing, avatar_url: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4 }} />
            <input placeholder="API Base URL" value={editing.api_base_url || ''}
              onChange={e => setEditing({ ...editing, api_base_url: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4 }} />
            <input placeholder="API Key" type="password" value={editing.api_key || ''}
              onChange={e => setEditing({ ...editing, api_key: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4 }} />
            <input placeholder="Model Name" value={editing.model_name || ''}
              onChange={e => setEditing({ ...editing, model_name: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleSave}
                style={{ padding: '8px 16px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                Save
              </button>
              <button onClick={() => { setEditing(null); setEditId(null) }}
                style={{ padding: '8px 16px', background: '#eee', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {agents.length === 0 ? (
        <p style={{ color: '#999', textAlign: 'center', padding: 48 }}>No agents configured. Add one to start!</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {agents.map(a => (
            <div key={a.id} style={{
              background: '#fff', padding: 16, borderRadius: 8,
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <strong>{a.name}</strong>
                <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{a.model_name}</div>
                {a.personality && <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{a.personality}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setEditing({...a}); setEditId(a.id) }}
                  style={{ padding: '4px 12px', background: '#eee', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                  Edit
                </button>
                <button onClick={() => handleDelete(a.id)}
                  style={{ padding: '4px 12px', background: '#f44336', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
