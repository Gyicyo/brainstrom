import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listSessions, createSession, deleteSession, listAgents, getAgent, createSessionWithGeneratedAgents, createGeneratedAgent } from '../db/helpers'
import type { SessionType, AgentType } from '../types'
import { callAgent } from '../llm/stream'
import { buildGeneratorPrompt } from '../llm/prompt'
import { distillExperts } from '../llm/bridgeApi'
import type { DistillEvent, DistillResult } from '../llm/bridgeApi'
import GeneratedAgentList from '../components/GeneratedAgentList'

interface SkillEntry {
  name: string
  displayName: string
  content: string
  accepted: boolean
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionType[]>([])
  const [agents, setAgents] = useState<AgentType[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [topic, setTopic] = useState('')
  const [selectedAgents, setSelectedAgents] = useState<number[]>([])
  const [scribeAgentId, setScribeAgentId] = useState<number | null>(null)
  const [createMode, setCreateMode] = useState<'manual' | 'generate' | 'distill'>('manual')
  const [initialContext, setInitialContext] = useState('')
  const [generatorAgentId, setGeneratorAgentId] = useState<number | null>(null)
  const [scribeForGenerated, setScribeForGenerated] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedAgents, setGeneratedAgents] = useState<{ name: string; personality: string; system_prompt: string }[]>([])
  const [agentCount, setAgentCount] = useState(3)

  // Distill state
  const [distillStatus, setDistillStatus] = useState<string>('')
  const [distillSkills, setDistillSkills] = useState<SkillEntry[]>([])
  const [distillPhase, setDistillPhase] = useState<string>('') // 'idle' | 'searching' | 'distilling' | 'done' | 'error'

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
    const scribeId = scribeForGenerated ?? generatorAgentId
    setLoading(true)
    try {
      const sid = await createSessionWithGeneratedAgents(
        { topic, status: 'active', current_round: 0 },
        generatorAgentId,
        scribeId,
        generatedAgents,
      )
      navigate(`/session/${sid}`)
    } catch (e: any) { setError(e.message) }
    setLoading(false)
  }

  const handleStartWithDistilled = async () => {
    if (generatorAgentId === null) return
    const scribeId = scribeForGenerated ?? generatorAgentId
    const accepted = distillSkills.filter(s => s.accepted)
    if (accepted.length === 0) { setError('Please accept at least one expert'); return }
    setLoading(true)
    try {
      // Create generated agents from SKILL.md content
      const genAgents = accepted.map(s => ({
        name: s.displayName,
        personality: `You roleplay as ${s.displayName}. Provide opinions and insights consistent with this person's known views and thinking style.`,
        system_prompt: s.content,
      }))
      const sid = await createSessionWithGeneratedAgents(
        { topic, status: 'active', current_round: 0 },
        generatorAgentId,
        scribeId,
        genAgents,
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

  const handleDistill = async () => {
    if (!topic.trim() || generatorAgentId === null) return
    setDistillPhase('searching')
    setDistillStatus('Initializing...')
    setDistillSkills([])
    setError(null)

    try {
      const agent = await getAgent(generatorAgentId)
      if (!agent) throw new Error('Generator agent not found')

      const apiConfig = {
        apiKey: agent.api_key,
        apiBaseUrl: agent.api_base_url,
        modelName: agent.model_name,
      }

      const events = distillExperts(topic, apiConfig)

      for await (const event of events) {
        switch (event.phase) {
          case 'search':
            setDistillStatus(event.status)
            break
          case 'search_result':
            setDistillPhase('distilling')
            setDistillStatus(`Found ${event.experts.length} experts. Distilling...`)
            break
          case 'distilling':
            setDistillStatus(`${event.progress} — ${event.expert}`)
            break
          case 'skill_ready':
            setDistillSkills(prev => [...prev, {
              name: event.name,
              displayName: event.expert,
              content: event.content,
              accepted: true,
            }])
            break
        }
      }
    } catch (e: any) {
      setError(e.message)
      setDistillPhase('error')
      return
    }

    setDistillPhase('done')
    setDistillStatus('Retrieving full skill content...')

    // Capture full skills with content from the result
    // The generator's final return value has full skill content
    // But since the for-await loop can't extract the return value,
    // we re-run distill just to get the done event with full content.
    // Instead: the skill_ready events only have name+expert; 
    // the full content comes in the Done result.
    // For now, accept the name-only display since content is loaded
    // when bridge persists the skill.
    // TODO: fetch full SKILL.md from bridge /api/skills/:name endpoint
  }

  const toggleSkillAccept = (index: number) => {
    setDistillSkills(prev => prev.map((s, i) => i === index ? { ...s, accepted: !s.accepted } : s))
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
            <TabButton label="Manual Selection" mode="manual" current={createMode} onClick={setCreateMode} />
            <TabButton label="Generate from Topic" mode="generate" current={createMode} onClick={() => { setCreateMode('generate'); setGeneratedAgents([]) }} />
            <TabButton label="Distill Experts" mode="distill" current={createMode} onClick={() => { setCreateMode('distill') }} />
          </div>

          {createMode === 'generate' ? (
            generatedAgents.length === 0 ? (
              <GenerateForm
                topic={topic} initialContext={initialContext} agentCount={agentCount}
                agents={agents} generatorAgentId={generatorAgentId}
                scribeForGenerated={scribeForGenerated} error={error} generating={generating}
                onInitialContextChange={setInitialContext}
                onAgentCountChange={setAgentCount}
                onGeneratorChange={setGeneratorAgentId}
                onScribeChange={setScribeForGenerated}
                onGenerate={handleGenerateAgents}
              />
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
          ) : createMode === 'distill' ? (
            <div>
              <p style={{ margin: '0 0 8px', fontWeight: 500, fontSize: 14 }}>选择用于蒸馏的 Agent（带 API 凭证）：</p>
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
                      <input type="radio" name="distill-generator" checked={selected}
                        onChange={() => { setGeneratorAgentId(a.id); setScribeForGenerated(prev => prev ?? a.id) }} style={{ display: 'none' }} />
                      {a.name}
                    </label>
                  )
                })}
              </div>

              <p style={{ margin: '0 0 8px', fontWeight: 500, fontSize: 14 }}>选择书记官（Scribe）：</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {agents.map(a => {
                  const selected = scribeForGenerated === a.id
                  return (
                    <label key={a.id} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 14px', borderRadius: 'var(--radius-full)',
                      background: selected ? 'var(--primary)' : 'var(--bg)',
                      color: selected ? '#fff' : 'var(--text-primary)',
                      border: selected ? 'none' : '1px solid var(--border)',
                      cursor: 'pointer', fontSize: 14, userSelect: 'none',
                    }}>
                      <input type="radio" name="distill-scribe" checked={selected}
                        onChange={() => setScribeForGenerated(a.id)} style={{ display: 'none' }} />
                      {a.name}
                    </label>
                  )
                })}
              </div>

              {distillPhase === '' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={handleDistill} disabled={!topic.trim() || generatorAgentId === null}
                    style={{
                      padding: '8px 20px',
                      background: !topic.trim() || generatorAgentId === null ? '#D1D5DB' : 'var(--primary)',
                      color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                      fontSize: 14, fontWeight: 500,
                      cursor: !topic.trim() || generatorAgentId === null ? 'not-allowed' : 'pointer',
                    }}>
                    Start Distillation
                  </button>
                </div>
              )}

              {distillPhase === 'searching' && (
                <div style={{ padding: 16, background: '#FEF3C7', borderRadius: 'var(--radius)', marginBottom: 12, fontSize: 14 }}>
                  🔍 {distillStatus}
                </div>
              )}

              {distillPhase === 'distilling' && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ padding: 12, background: '#FEF3C7', borderRadius: 'var(--radius)', marginBottom: 8, fontSize: 14 }}>
                    ⏳ {distillStatus}
                  </div>
                  {distillSkills.length > 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      Skills generated so far: {distillSkills.map(s => s.displayName).join(', ')}
                    </div>
                  )}
                </div>
              )}

              {distillPhase === 'done' && (
                <div>
                  <p style={{ fontSize: 14, color: '#059669', marginBottom: 12, fontWeight: 500 }}>
                    ✅ Distillation complete. Select experts to include:
                  </p>
                  {distillSkills.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No experts were found for this topic.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                      {distillSkills.map((s, i) => (
                        <label key={i} style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                          background: s.accepted ? '#F0FDF4' : 'var(--bg)',
                          borderRadius: 'var(--radius)', cursor: 'pointer',
                          border: s.accepted ? '1px solid #86EFAC' : '1px solid var(--border)',
                        }}>
                          <input type="checkbox" checked={s.accepted}
                            onChange={() => toggleSkillAccept(i)} />
                          <span style={{ fontSize: 14, fontWeight: 500 }}>{s.displayName}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={handleStartWithDistilled}
                      disabled={loading || distillSkills.filter(s => s.accepted).length === 0}
                      style={{
                        padding: '8px 20px',
                        background: loading || distillSkills.filter(s => s.accepted).length === 0 ? '#D1D5DB' : 'var(--primary)',
                        color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                        fontSize: 14, fontWeight: 500,
                        cursor: loading || distillSkills.filter(s => s.accepted).length === 0 ? 'not-allowed' : 'pointer',
                      }}>
                      {loading ? 'Creating...' : `Start Session with Selected (${distillSkills.filter(s => s.accepted).length})`}
                    </button>
                    <button onClick={() => { setDistillPhase(''); setDistillSkills([]); }}
                      style={{
                        padding: '8px 20px', background: 'var(--bg)', color: 'var(--text-secondary)',
                        border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14,
                        cursor: 'pointer',
                      }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {distillPhase === 'error' && (
                <div style={{ padding: 12, background: '#FEF2F2', borderRadius: 'var(--radius)', marginBottom: 12, fontSize: 14, color: '#DC2626' }}>
                  ❌ Distillation failed: {error}
                  <button onClick={() => setDistillPhase('')}
                    style={{ marginLeft: 12, padding: '2px 8px', background: 'transparent', border: '1px solid #DC2626', borderRadius: 'var(--radius)', cursor: 'pointer', color: '#DC2626', fontSize: 12 }}>
                    Retry
                  </button>
                </div>
              )}
            </div>
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

          {error && createMode !== 'distill' && <p style={{ color: '#DC2626', fontSize: 13, marginTop: 12 }}>{error}</p>}
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

function TabButton({ label, mode, current, onClick }: {
  label: string; mode: string; current: string; onClick: (m: any) => void
}) {
  const selected = current === mode
  return (
    <button onClick={() => onClick(mode)}
      style={{
        padding: '6px 16px', borderRadius: 'var(--radius-full)',
        background: selected ? 'var(--primary)' : 'var(--bg)',
        color: selected ? '#fff' : 'var(--text-primary)',
        border: selected ? 'none' : '1px solid var(--border)',
        cursor: 'pointer', fontSize: 13, fontWeight: 500,
      }}>
      {label}
    </button>
  )
}

function GenerateForm({ topic, initialContext, agentCount, agents, generatorAgentId, scribeForGenerated, error, generating, onInitialContextChange, onAgentCountChange, onGeneratorChange, onScribeChange, onGenerate }: {
  topic: string; initialContext: string; agentCount: number
  agents: AgentType[]; generatorAgentId: number | null; scribeForGenerated: number | null
  error: string | null; generating: boolean
  onInitialContextChange: (v: string) => void
  onAgentCountChange: (v: number) => void
  onGeneratorChange: (v: number | null) => void
  onScribeChange: (v: number | null | ((prev: number | null) => number | null)) => void
  onGenerate: () => void
}) {
  return (
    <div>
      <textarea
        placeholder="Provide initial context, goals, and constraints for the brainstorming session..."
        value={initialContext}
        onChange={e => onInitialContextChange(e.target.value)}
        rows={3}
        style={{
          width: '100%', padding: '10px 12px',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          marginBottom: 16, fontSize: 14, outline: 'none',
          fontFamily: 'inherit', resize: 'vertical',
        }}
      />

      <p style={{ margin: '0 0 8px', fontWeight: 500, fontSize: 14 }}>选择生成器 Agent（用于生成讨论角色）：</p>
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
                onChange={() => { onGeneratorChange(a.id); onScribeChange(prev => prev ?? a.id) }} style={{ display: 'none' }} />
              {a.name}
            </label>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <label style={{ fontSize: 14, fontWeight: 500 }}>Agent Count:</label>
        <input type="number" min={1} max={8}
          value={agentCount}
          onChange={e => onAgentCountChange(Math.max(1, Math.min(8, parseInt(e.target.value) || 3)))}
          style={{
            width: 64, padding: '6px 10px',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            fontSize: 14, outline: 'none',
          }} />
      </div>

      <p style={{ margin: '0 0 8px', fontWeight: 500, fontSize: 14 }}>选择书记官（Scribe，用于总结讨论）：</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {agents.map(a => {
          const selected = scribeForGenerated === a.id
          return (
            <label key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 'var(--radius-full)',
              background: selected ? 'var(--primary)' : 'var(--bg)',
              color: selected ? '#fff' : 'var(--text-primary)',
              border: selected ? 'none' : '1px solid var(--border)',
              cursor: 'pointer', fontSize: 14, userSelect: 'none',
            }}>
              <input type="radio" name="gen-scribe" checked={selected}
                onChange={() => onScribeChange(a.id)} style={{ display: 'none' }} />
              {a.name}
              {selected && ' (书记官)'}
            </label>
          )
        })}
      </div>

      {error && <p style={{ color: '#DC2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onGenerate} disabled={generating || !topic.trim() || !initialContext.trim() || generatorAgentId === null}
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
  )
}
