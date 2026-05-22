import { useEffect, useState } from 'react'
import { listAgents, createAgent, updateAgent, deleteAgent, getAgent } from '../db/helpers'
import { callAgent } from '../llm/stream'
import { buildSystemPrompt } from '../llm/prompt'
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
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [testingId, setTestingId] = useState<number | null>(null)

  const load = async () => {
    try { setAgents(await listAgents() as AgentType[]) } catch (e) { console.error(e) }
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

  const handleTest = async (id: number) => {
    setTestingId(id)
    try {
      const agent = await getAgent(id)
      if (!agent) {
        setTestResult({ success: false, message: 'Agent not found in database' })
        setTestingId(null)
        return
      }
      const response = await callAgent(
        agent,
        buildSystemPrompt(agent, 'This is a connection test.', 'Respond with a brief confirmation message.'),
        256,
      )
      setTestResult({ success: true, message: response })
    } catch (e: any) {
      setTestResult({ success: false, message: e.message || String(e) })
    }
    setTestingId(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Agent Configuration</h1>
        <button onClick={() => { setEditing({...emptyForm}); setEditId(null) }}
          style={{ padding: '8px 20px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>
          + Add Agent
        </button>
      </div>

      {editing && (
        <div style={{
          background: 'var(--surface)', padding: 24, borderRadius: 'var(--radius-lg)',
          marginBottom: 24, boxShadow: 'var(--shadow)', border: '1px solid var(--border)',
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>{editId ? 'Edit Agent' : 'New Agent'}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input placeholder="Name" value={editing.name || ''}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
              style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, outline: 'none' }} />
            <textarea placeholder="Personality / Role Description" value={editing.personality || ''}
              onChange={e => setEditing({ ...editing, personality: e.target.value })}
              style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, outline: 'none', minHeight: 60 }} />
            <textarea placeholder="System Prompt" value={editing.system_prompt || ''}
              onChange={e => setEditing({ ...editing, system_prompt: e.target.value })}
              style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, outline: 'none', minHeight: 80 }} />
            <input placeholder="Avatar URL (optional)" value={editing.avatar_url || ''}
              onChange={e => setEditing({ ...editing, avatar_url: e.target.value })}
              style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, outline: 'none' }} />
            <input placeholder="API Base URL" value={editing.api_base_url || ''}
              onChange={e => setEditing({ ...editing, api_base_url: e.target.value })}
              style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, outline: 'none' }} />
            <input placeholder="API Key" type="password" value={editing.api_key || ''}
              onChange={e => setEditing({ ...editing, api_key: e.target.value })}
              style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, outline: 'none' }} />
            <input placeholder="Model Name" value={editing.model_name || ''}
              onChange={e => setEditing({ ...editing, model_name: e.target.value })}
              style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, outline: 'none' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleSave}
                style={{ padding: '8px 20px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>
                Save
              </button>
              <button onClick={() => { setEditing(null); setEditId(null) }}
                style={{ padding: '8px 20px', background: 'var(--bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 14 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {agents.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48, fontSize: 14 }}>
          No agents configured. Add one to start!
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {agents.map(a => (
            <div key={a.id} style={{
              background: 'var(--surface)', padding: '16px 20px', borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <strong style={{ fontSize: 15 }}>{a.name}</strong>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{a.model_name}</div>
                {a.personality && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{a.personality}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handleTest(a.id)} disabled={testingId === a.id}
                  style={{
                    padding: '4px 12px',
                    background: testingId === a.id ? '#D1D5DB' : 'var(--success)',
                    color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                    cursor: testingId === a.id ? 'not-allowed' : 'pointer', fontSize: 13,
                  }}>
                  {testingId === a.id ? 'Testing...' : 'Test'}
                </button>
                <button onClick={() => { setEditing({...a}); setEditId(a.id) }}
                  style={{ padding: '4px 12px', background: 'var(--bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13 }}>
                  Edit
                </button>
                <button onClick={() => handleDelete(a.id)}
                  style={{ padding: '4px 12px', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13 }}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {testResult && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.4)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setTestResult(null)}>
          <div style={{
            background: '#fff', padding: 24, borderRadius: 'var(--radius-lg)',
            maxWidth: 520, width: '90%', boxShadow: 'var(--shadow-md)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                background: testResult.success ? 'var(--success)' : 'var(--danger)',
                display: 'inline-block',
              }} />
              <strong style={{ fontSize: 15 }}>
                {testResult.success ? 'Connection Successful' : 'Connection Failed'}
              </strong>
            </div>
            <div style={{
              fontSize: 13, whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto',
              background: 'var(--bg)', padding: 12, borderRadius: 'var(--radius)',
              fontFamily: 'monospace', lineHeight: 1.5, color: 'var(--text-primary)',
            }}>
              {testResult.message}
            </div>
            <button onClick={() => setTestResult(null)}
              style={{
                marginTop: 12, padding: '8px 20px', background: 'var(--primary)',
                color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                cursor: 'pointer', fontSize: 14, fontWeight: 500,
              }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
