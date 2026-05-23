import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listSessions, createSession, deleteSession, listAgents, getAgent, createSessionWithGeneratedAgents } from '../db/helpers'
import type { SessionType, AgentType } from '../types'
import { callAgent } from '../llm/stream'
import { buildGeneratorPrompt } from '../llm/prompt'
import GeneratedAgentList from '../components/GeneratedAgentList'

export default function Dashboard() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionType[]>([])
  const [agents, setAgents] = useState<AgentType[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [topic, setTopic] = useState('')
  const [selectedAgents, setSelectedAgents] = useState<number[]>([])
  const [scribeAgentId, setScribeAgentId] = useState<number | null>(null)
  const [createMode, setCreateMode] = useState<'manual' | 'generate'>('manual')
  const [initialContext, setInitialContext] = useState('')
  const [generatorAgentId, setGeneratorAgentId] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedAgents, setGeneratedAgents] = useState<{ name: string; personality: string; system_prompt: string }[]>([])
  const [agentCount, setAgentCount] = useState(3)

  const load = async () => {
    try {
      const [s, a] = await Promise.all([listSessions(), listAgents()])
      setSessions(s as SessionType[])
      setAgents(a as AgentType[])
    } catch (e) {
      console.error('Failed to load data', e)
    }
  }

  useEffect(() => { load() }, [])

  // Reset scribe when the scribe's agent is removed from participants
  useEffect(() => {
    setScribeAgentId(prev => (prev !== null && !selectedAgents.includes(prev)) ? null : prev)
  }, [selectedAgents])

  const handleCreate = async () => {
    if (!topic.trim() || selectedAgents.length === 0 || scribeAgentId === null) return
    await createSession(
      { topic, status: 'active', current_round: 0 },
      selectedAgents,
      scribeAgentId,
    )
    setShowCreate(false)
    setTopic('')
    setSelectedAgents([])
    setScribeAgentId(null)
    load()
  }

  const toggleAgent = (id: number) => {
    setSelectedAgents(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    )
  }

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    if (!confirm('Delete this session and all its data? This cannot be undone.')) return
    try {
      await deleteSession(id)
      load()
    } catch (e) {
      console.error(e)
    }
  }

  const handleGenerateAgents = async () => {
    if (!topic.trim() || !initialContext.trim() || generatorAgentId === null) return
    setGenerating(true)
    setError(null)
    try {
      const agent = await getAgent(generatorAgentId)
      if (!agent) throw new Error('Generator agent not found')
      const prompt = buildGeneratorPrompt(agent.name, topic, initialContext, agentCount)
      const response = await callAgent(agent, prompt, 4096)
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('Invalid response format from generator LLM')
      const data = JSON.parse(jsonMatch[0])
      if (!Array.isArray(data.agents) || data.agents.length === 0) throw new Error('No agents generated')
      setGeneratedAgents(data.agents)
    } catch (e: any) { setError(e.message); setGeneratedAgents([]) }
    setGenerating(false)
  }

  const handleStartWithGenerated = async () => {
    if (generatorAgentId === null) return
    setLoading(true)
    try {
      const sid = await createSessionWithGeneratedAgents(
        { topic, status: 'active', current_round: 0 },
        generatorAgentId,
        generatedAgents,
      )
      navigate(`/session/${sid}`)
    } catch (e: any) { setError(e.message) }
    setLoading(false)
  }

  const regenerateGeneratedAgent = async (index: number) => {
    if (generatorAgentId === null) return
    setGenerating(true)
    setError(null)
    try {
      const agent = await getAgent(generatorAgentId)
      if (!agent) throw new Error('Generator agent not found')
      const prompt = buildGeneratorPrompt(agent.name, topic, initialContext, 1)
      const response = await callAgent(agent, prompt, 4096)
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('Invalid response format from generator LLM')
      const data = JSON.parse(jsonMatch[0])
      if (!Array.isArray(data.agents) || data.agents.length === 0) throw new Error('No agent generated')
      setGeneratedAgents(prev => prev.map((a, i) => i === index ? data.agents[0] : a))
    } catch (e: any) { setError(e.message) }
    setGenerating(false)
  }

  const editGeneratedAgent = (index: number, updates: Partial<{ name: string; personality: string; system_prompt: string }>) => {
    setGeneratedAgents(prev => prev.map((a, i) => i === index ? { ...a, ...updates } : a))
  }

  const regenerateAllGeneratedAgents = () => {
    handleGenerateAgents()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Sessions</h1>
        <button onClick={() => setShowCreate(true)}
          style={{ padding: '8px 20px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>
          + New Session
        </button>
      </div>

      {showCreate && (
        <div style={{
          background: 'var(--surface)', padding: 24, borderRadius: 'var(--radius-lg)',
          marginBottom: 24, boxShadow: 'var(--shadow)', border: '1px solid var(--border)',
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>Create New Brainstorm Session</h3>
          <input
            placeholder="Enter brainstorming topic..."
            value={topic}
            onChange={e => setTopic(e.target.value)}
            style={{
              width: '100%', padding: '10px 12px', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', marginBottom: 16,
              fontSize: 14, outline: 'none',
            }}
          />

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onClick={() => { setCreateMode('manual'); setGeneratedAgents([]) }}
              style={{
                padding: '6px 16px', borderRadius: 'var(--radius-full)',
                background: createMode === 'manual' ? 'var(--primary)' : 'var(--bg)',
                color: createMode === 'manual' ? '#fff' : 'var(--text-primary)',
                border: createMode === 'manual' ? 'none' : '1px solid var(--border)',
                cursor: 'pointer', fontSize: 13, fontWeight: 500,
              }}>
              Manual Selection
            </button>
            <button onClick={() => setCreateMode('generate')}
              style={{
                padding: '6px 16px', borderRadius: 'var(--radius-full)',
                background: createMode === 'generate' ? 'var(--primary)' : 'var(--bg)',
                color: createMode === 'generate' ? '#fff' : 'var(--text-primary)',
                border: createMode === 'generate' ? 'none' : '1px solid var(--border)',
                cursor: 'pointer', fontSize: 13, fontWeight: 500,
              }}>
              Generate from Topic
            </button>
          </div>

          {createMode === 'generate' ? (
            generatedAgents.length === 0 ? (
              <div>
                <textarea
                  placeholder="Provide initial context, goals, and constraints for the brainstorming session..."
                  value={initialContext}
                  onChange={e => setInitialContext(e.target.value)}
                  rows={3}
                  style={{
                    width: '100%', padding: '10px 12px',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                    marginBottom: 16, fontSize: 14, outline: 'none',
                    fontFamily: 'inherit', resize: 'vertical',
                  }}
                />

                <p style={{ margin: '0 0 8px', fontWeight: 500, fontSize: 14 }}>选择生成器 Agent（同时也是书记官）：</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                  {agents.map(a => {
                    const selected = generatorAgentId === a.id
                    return (
                      <label key={a.id} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '6px 14px', borderRadius: 'var(--radius-full)',
                        background: selected ? 'var(--primary)' : 'var(--bg)',
                        color: selected ? '#fff' : 'var(--text-primary)',
                        border: selected ? 'none' : '1px solid var(--border)',
                        cursor: 'pointer', fontSize: 14, userSelect: 'none',
                      }}>
                        <input type="radio" name="generator" checked={selected}
                          onChange={() => setGeneratorAgentId(a.id)} style={{ display: 'none' }} />
                        {a.name}
                      </label>
                    )
                  })}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <label style={{ fontSize: 14, fontWeight: 500 }}>Agent Count:</label>
                  <input type="number" min={1} max={8}
                    value={agentCount}
                    onChange={e => setAgentCount(Math.max(1, Math.min(8, parseInt(e.target.value) || 3)))}
                    style={{
                      width: 64, padding: '6px 10px',
                      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                      fontSize: 14, outline: 'none',
                    }} />
                </div>

                {error && <p style={{ color: '#DC2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={handleGenerateAgents} disabled={generating || !topic.trim() || !initialContext.trim() || generatorAgentId === null}
                    style={{
                      padding: '8px 20px',
                      background: generating || !topic.trim() || !initialContext.trim() || generatorAgentId === null ? '#D1D5DB' : 'var(--primary)',
                      color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                      fontSize: 14, fontWeight: 500, cursor: generating ? 'not-allowed' : 'pointer',
                    }}>
                    {generating ? 'Generating...' : 'Generate Agents'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <GeneratedAgentList
                  agents={generatedAgents}
                  loading={generating}
                  onEdit={editGeneratedAgent}
                  onRegenerate={regenerateGeneratedAgent}
                  onRegenerateAll={regenerateAllGeneratedAgents}
                  onStart={handleStartWithGenerated}
                />
              </div>
            )
          ) : (
            <>
              <p style={{ margin: '0 0 8px', fontWeight: 500, fontSize: 14 }}>选择参与讨论的 Agent：</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
                {agents.map(a => {
                  const selected = selectedAgents.includes(a.id)
                  return (
                    <label key={a.id} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 14px', borderRadius: 'var(--radius-full)',
                      background: selected ? 'var(--primary)' : 'var(--bg)',
                      color: selected ? '#fff' : 'var(--text-primary)',
                      border: selected ? 'none' : '1px solid var(--border)',
                      cursor: 'pointer', fontSize: 14, userSelect: 'none',
                      transition: 'all 0.15s',
                    }}>
                      <input type="checkbox" checked={selected}
                        onChange={() => toggleAgent(a.id)} style={{ display: 'none' }} />
                      {a.name}
                    </label>
                  )
                })}
              </div>

              <p style={{ margin: '0 0 8px', fontWeight: 500, fontSize: 14 }}>选择书记官（Scribe）：</p>
              {selectedAgents.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 20 }}>
                  请先选择参与讨论的 Agent
                </p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
                  {agents.filter(a => selectedAgents.includes(a.id)).map(a => {
                    const isScribe = scribeAgentId === a.id
                    return (
                      <label key={a.id} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '6px 14px', borderRadius: 'var(--radius-full)',
                        background: isScribe ? 'var(--primary)' : 'var(--bg)',
                        color: isScribe ? '#fff' : 'var(--text-primary)',
                        border: isScribe ? 'none' : '1px solid var(--border)',
                        cursor: 'pointer', fontSize: 14, userSelect: 'none',
                        transition: 'all 0.15s',
                      }}>
                        <input type="radio" name="scribe" checked={isScribe}
                          onChange={() => setScribeAgentId(a.id)} style={{ display: 'none' }} />
                        {a.name}
                        {isScribe && ' (书记官)'}
                      </label>
                    )
                  })}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleCreate}
                  disabled={!topic.trim() || selectedAgents.length === 0 || scribeAgentId === null}
                  style={{
                    padding: '8px 20px', background: 'var(--primary)', color: '#fff',
                    border: 'none', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 500,
                    cursor: 'pointer',
                  }}>
                  Start Session
                </button>
                <button onClick={() => { setShowCreate(false); setScribeAgentId(null) }}
                  style={{
                    padding: '8px 20px', background: 'var(--bg)', color: 'var(--text-secondary)',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14,
                    cursor: 'pointer',
                  }}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {sessions.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48, fontSize: 14 }}>
          No sessions yet. Create one to get started!
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sessions.map(s => (
            <div key={s.id} onClick={() => navigate(`/session/${s.id}`)}
              style={{
                background: 'var(--surface)', padding: '16px 20px', borderRadius: 'var(--radius-lg)',
                cursor: 'pointer', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                transition: 'box-shadow 0.15s',
              }}>
              <div>
                <strong style={{ fontSize: 15 }}>{s.topic || '(No topic)'}</strong>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Round {s.current_round} · {s.status}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {new Date(s.created_at).toLocaleDateString()}
                </div>
                <button onClick={(e) => handleDelete(e, s.id)}
                  style={{
                    padding: '4px 8px', background: 'transparent', color: 'var(--text-muted)',
                    border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12,
                  }}>
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
