import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listSessions, deleteSession, createSessionWithRoles } from '../db/helpers'
import type { SessionType } from '../types'
import { suggestRoles, distillRoles, createRoom, deleteRoom } from '../llm/bridgeApi'
import { loadLLMConfig } from './LLMConfig'
import type { LLMConfigType } from './LLMConfig'

interface RoleEntry {
  name: string
  bio: string
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionType[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Search mode state
  const [content, setContent] = useState('')
  const [agentCount, setAgentCount] = useState(5)
  const [searchResults, setSearchResults] = useState<RoleEntry[]>([])
  const [searchStatus, setSearchStatus] = useState<'idle' | 'searching' | 'results' | 'error'>('idle')
  const [searchError, setSearchError] = useState<string | null>(null)

  // Distill roles state
  const [distillRolesPhase, setDistillRolesPhase] = useState<string>('')
  const [distilledTopic, setDistilledTopic] = useState('')
  const [distilledRoles, setDistilledRoles] = useState<{ name: string; bio: string; skillContent: string }[]>([])
  const [roleStatuses, setRoleStatuses] = useState<{ name: string; status: 'pending' | 'distilling' | 'done' | 'error'; error?: string }[]>([])

  const [llmConfig, setLlmConfig] = useState<LLMConfigType>(loadLLMConfig)

  const load = async () => {
    try {
      const s = await listSessions()
      setSessions(s as SessionType[])
      setLlmConfig(loadLLMConfig())
    } catch (e) {
      console.error('Failed to load data', e)
    }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    if (!confirm('删除此会话及其所有数据？此操作不可撤销。')) return
    try { await deleteRoom(id); await deleteSession(id); load() } catch (e) { console.error(e) }
  }

  const handleSearchRoles = async () => {
    if (!topic.trim()) return
    if (!llmConfig.apiKey) { setSearchError('请在 LLM 设置中填写 API Key'); return }
    setSearchStatus('searching')
    setSearchError(null)
    setSearchResults([])
    try {
      const data = await suggestRoles(
        topic.trim(),
        content.trim(),
        agentCount,
        { apiBaseUrl: llmConfig.baseUrl, apiKey: llmConfig.apiKey, modelName: llmConfig.modelName },
      )
      setSearchResults(data.roles || [])
      setSearchStatus('results')
    } catch (e: any) {
      setSearchError(e.message)
      setSearchStatus('error')
    }
  }

  const handleAddCustom = () => {
    const name = prompt('输入角色名称：')
    if (!name?.trim()) return
    const bio = prompt('输入角色简介（留空可跳过）：')
    setSearchResults(prev => [...prev, { name: name.trim(), bio: bio?.trim() || '' }])
  }

  const handleDistillRoles = async () => {
    const roles = searchResults.filter(r => r.name.trim())
    if (roles.length === 0) return
    if (!llmConfig.apiKey) { setSearchError('请在 LLM 设置中填写 API Key'); return }

    setDistillRolesPhase('distilling')
    setRoleStatuses([])
    setDistilledRoles([])
    setSearchError(null)

    try {
      const apiConfig = {
        apiKey: llmConfig.apiKey,
        apiBaseUrl: llmConfig.baseUrl,
        modelName: llmConfig.modelName,
      }
      const sessionDir = topic.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
      setDistilledTopic(sessionDir)
      const events = distillRoles(sessionDir, roles, apiConfig)

      for await (const event of events) {
        switch (event.phase) {
          case 'batch_start':
            setRoleStatuses(event.roles.map(r => ({ name: r.name, status: 'pending' as const })))
            break
          case 'distill_start':
            setRoleStatuses(prev => prev.map(r => r.name === event.expert ? { ...r, status: 'distilling' as const } : r))
            break
          case 'skill_ready':
            setRoleStatuses(prev => prev.map(r => r.name === event.expert ? { ...r, status: 'done' } : r))
            break
          case 'distill_error':
            setRoleStatuses(prev => prev.map(r => r.name === event.expert ? { ...r, status: 'error', error: event.error } : r))
            break
        }
      }
    } catch (e: any) {
      setSearchError(e.message)
    }

    // Fetch full results from GET endpoint
    try {
      const sessionDir = topic.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
      const { fetchDistillResults } = await import('../llm/bridgeApi')
      const result = await fetchDistillResults(sessionDir)
      setDistilledRoles(result.skills.map(s => ({ name: s.displayName, bio: '', skillContent: s.content })))
    } catch (e: any) {
      setSearchError(e.message)
    }

    setDistillRolesPhase('done')
  }

  const handleEnterDiscussion = async () => {
    const roles = distilledRoles.filter(r => r.skillContent)
    if (roles.length === 0) return
    setLoading(true)
    try {
      const sid = await createSessionWithRoles(
        { topic: topic.trim(), status: 'active', current_round: 0 },
        roles.map(r => ({
          name: r.name,
          personality: r.bio || `You roleplay as ${r.name}.`,
          system_prompt: r.skillContent,
          is_scribe: false,
        })),
      )
      await createRoom(
        sid,
        topic.trim(),
        roles.map(r => ({ name: r.name, skillContent: r.skillContent })),
        { apiBaseUrl: llmConfig.baseUrl, apiKey: llmConfig.apiKey, modelName: llmConfig.modelName },
      )
      navigate(`/session/${sid}`)
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  const handleDeleteRole = (index: number) => {
    setSearchResults(prev => prev.filter((_, i) => i !== index))
  }

  const handleEditRole = (index: number, field: 'name' | 'bio') => {
    const role = searchResults[index]
    if (!role) return
    const value = prompt(`修改${field === 'name' ? '名称' : '简介'}：`, role[field])
    if (value === null) return
    setSearchResults(prev => prev.map((r, i) => i === index ? { ...r, [field]: value.trim() } : r))
  }

  return (
    <div>
      <style>{`
@keyframes distillSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes distillPulse {
  0%, 100% { border-color: #FDE68A; }
  50% { border-color: #F59E0B; }
}
@keyframes charWave {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
`}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>会话列表</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {!llmConfig.apiKey && (
            <span style={{ fontSize: 12, color: '#DC2626', fontStyle: 'italic' }}>请先配置 LLM 设置</span>
          )}
          <button onClick={() => setShowCreate(true)}
            style={{ padding: '8px 20px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>
            + 新建会话
          </button>
        </div>
      </div>

      {showCreate && (
        <div style={{
          background: 'var(--surface)', padding: 24, borderRadius: 'var(--radius-lg)',
          marginBottom: 24, boxShadow: 'var(--shadow)', border: '1px solid var(--border)',
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>创建新的头脑风暴会话</h3>
          <input
            placeholder="输入头脑风暴主题..."
            value={topic}
            onChange={e => setTopic(e.target.value)}
            style={{
              width: '100%', padding: '10px 12px', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', marginBottom: 16, fontSize: 14, outline: 'none',
            }}
          />

          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, padding: '8px 12px', background: '#F0F9FF', borderRadius: 'var(--radius)' }}>
            当前模型: {llmConfig.modelName} @ {llmConfig.baseUrl}
          </div>

          <div>
              {searchStatus === 'idle' && (
                <div>
                  <textarea
                    placeholder="提供讨论的背景信息、目标和约束条件..."
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    rows={3}
                    style={{
                      width: '100%', padding: '10px 12px',
                      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                      marginBottom: 16, fontSize: 14, outline: 'none',
                      fontFamily: 'inherit', resize: 'vertical',
                    }}
                  />

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <label style={{ fontSize: 14, fontWeight: 500 }}>所需角色数:</label>
                    <input type="number" min={1} max={20}
                      value={agentCount}
                      onChange={e => setAgentCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 5)))}
                      style={{
                        width: 64, padding: '6px 10px',
                        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                        fontSize: 14, outline: 'none',
                      }} />
                  </div>

                  {searchError && <p style={{ color: '#DC2626', fontSize: 13, marginBottom: 12 }}>{searchError}</p>}

                  <button onClick={handleSearchRoles} disabled={!topic.trim()}
                    style={{
                      padding: '8px 20px',
                      background: !topic.trim() ? '#D1D5DB' : 'var(--primary)',
                      color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                      fontSize: 14, fontWeight: 500, cursor: !topic.trim() ? 'not-allowed' : 'pointer',
                    }}>
                    搜索角色
                  </button>
                </div>
              )}

              {searchStatus === 'searching' && (
                <div style={{ padding: 16, background: '#FEF3C7', borderRadius: 'var(--radius)', marginBottom: 12, fontSize: 14 }}>
                  🔍 正在搜索与「{topic}」相关的角色...
                </div>
              )}

              {searchStatus === 'results' && (
                <div>
                  <p style={{ fontSize: 14, color: '#059669', marginBottom: 12, fontWeight: 500 }}>
                    ✅ 找到 {searchResults.length} 个角色。点击名称/简介可编辑，勾选表示选用：
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                    {searchResults.map((role, i) => (
                      <div key={i} style={{
                        padding: '12px 16px',
                        background: 'var(--bg)',
                        borderRadius: 'var(--radius)',
                        border: '1px solid var(--border)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1 }}>
                            <div
                              onClick={() => handleEditRole(i, 'name')}
                              style={{ fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 4, color: 'var(--text-primary)' }}>
                              {role.name}
                            </div>
                            <div
                              onClick={() => handleEditRole(i, 'bio')}
                              style={{ fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer', lineHeight: 1.5 }}>
                              {role.bio || '（无简介）'}
                            </div>
                          </div>
                          <button onClick={() => handleDeleteRole(i)}
                            style={{
                              padding: '4px 8px', background: 'transparent', color: '#DC2626',
                              border: '1px solid #DC2626', borderRadius: 'var(--radius)',
                              cursor: 'pointer', fontSize: 12, marginLeft: 12, flexShrink: 0,
                            }}>
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                    <button onClick={handleDistillRoles}
                      disabled={distillRolesPhase === 'distilling'}
                      style={{
                        padding: '8px 20px',
                        background: distillRolesPhase === 'distilling' ? '#D1D5DB' : '#7C3AED',
                        color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                        fontSize: 14, fontWeight: 500,
                        cursor: distillRolesPhase === 'distilling' ? 'not-allowed' : 'pointer',
                      }}>
                      {distillRolesPhase === 'distilling' ? '蒸馏中...' : `蒸馏所选角色 (${searchResults.length})`}
                    </button>
                    <button onClick={handleAddCustom}
                      style={{
                        padding: '8px 16px', background: 'var(--bg)', color: 'var(--text-secondary)',
                        border: '1px dashed var(--border)', borderRadius: 'var(--radius)',
                        fontSize: 14, cursor: 'pointer',
                      }}>
                      + 添加自定义角色
                    </button>
                    <button onClick={() => { setSearchStatus('idle'); setSearchResults([]); setDistillRolesPhase(''); setRoleStatuses([]) }}
                      style={{
                        padding: '8px 16px', background: 'var(--bg)', color: 'var(--text-secondary)',
                        border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14,
                        cursor: 'pointer',
                      }}>
                      重新搜索
                    </button>
                  </div>

                  {distillRolesPhase === 'distilling' && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>⏳ 蒸馏进度：</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {roleStatuses.map((r, i) => (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '6px 12px', borderRadius: 'var(--radius)',
                            background: r.status === 'done' ? '#F0FDF4' : r.status === 'error' ? '#FEF2F2' : r.status === 'distilling' ? '#FFFBED' : '#FFF7ED',
                            border: `1px solid ${
                              r.status === 'done' ? '#86EFAC' : r.status === 'error' ? '#FCA5A5' : r.status === 'distilling' ? '#F59E0B' : '#FDE68A'
                            }`,
                            fontSize: 14,
                            ...(r.status === 'distilling' ? { animation: 'distillPulse 1.5s ease-in-out infinite' } : {}),
                          }}>
                            <span style={{ flexShrink: 0 }}>
                              {r.status === 'pending' && '⏳'}
                              {r.status === 'distilling' && (
                                <span style={{
                                  display: 'inline-block', width: 14, height: 14,
                                  border: '2px solid #FDE68A',
                                  borderTopColor: '#F59E0B',
                                  borderRadius: '50%',
                                  animation: 'distillSpin 0.7s linear infinite',
                                }} />
                              )}
                              {r.status === 'done' && '✅'}
                              {r.status === 'error' && '❌'}
                            </span>
                            <span style={{ flex: 1, fontWeight: 500 }}>{r.name}</span>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              {r.status === 'pending' && '等待中'}
                              {r.status === 'distilling' && (
                                <span style={{ display: 'inline-flex', color: '#10B981' }}>
                                  {'蒸馏中...'.split('').map((ch, ci) => (
                                    <span key={ci} style={{
                                      display: 'inline-block',
                                      animation: `charWave 5s ease-in-out ${ci * 0.3}s infinite`,
                                    }}>{ch}</span>
                                  ))}
                                </span>
                              )}
                              {r.status === 'done' && '已完成'}
                              {r.status === 'error' && `失败: ${r.error || ''}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {distillRolesPhase === 'done' && (
                    <div>
                      <div style={{ padding: 12, background: '#F0FDF4', borderRadius: 'var(--radius)', marginBottom: 8, fontSize: 14, color: '#059669' }}>
                        ✅ 蒸馏完成！共生成 {distilledRoles.length} 个角色 SKILL。
                        <div style={{ fontSize: 12, marginTop: 6, color: 'var(--text-secondary)' }}>
                          文件保存在 bridge/sessions/{distilledTopic}/ 目录下
                        </div>
                      </div>
                      <button onClick={handleEnterDiscussion} disabled={loading || distilledRoles.length === 0}
                        style={{
                          padding: '10px 24px',
                          background: loading || distilledRoles.length === 0 ? '#D1D5DB' : '#059669',
                          color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                          fontSize: 15, fontWeight: 600,
                          cursor: loading || distilledRoles.length === 0 ? 'not-allowed' : 'pointer',
                        }}>
                        {loading ? '创建中...' : `进入讨论室 (${distilledRoles.length} 个角色)`}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {searchStatus === 'error' && (
                <div style={{ padding: 12, background: '#FEF2F2', borderRadius: 'var(--radius)', marginBottom: 12, fontSize: 14, color: '#DC2626' }}>
                  ❌ {searchError}
                  <button onClick={() => setSearchStatus('idle')}
                    style={{ marginLeft: 12, padding: '2px 8px', background: 'transparent', border: '1px solid #DC2626', borderRadius: 'var(--radius)', cursor: 'pointer', color: '#DC2626', fontSize: 12 }}>
                    重试
                  </button>
                </div>
              )}
            </div>

          {error && <p style={{ color: '#DC2626', fontSize: 13, marginTop: 12 }}>{error}</p>}
        </div>
      )}

      {sessions.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48, fontSize: 14 }}>
          暂无会话，创建第一个开始吧！
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sessions.map(s => (
            <div key={s.id} onClick={() => navigate(`/session/${s.id}`)}
              style={{
                background: 'var(--surface)', padding: '16px 20px', borderRadius: 'var(--radius-lg)',
                cursor: 'pointer', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
              <div>
                <strong style={{ fontSize: 15 }}>{s.topic || '(无主题)'}</strong>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  第 {s.current_round} 轮 · {s.status === 'active' ? '进行中' : s.status === 'completed' ? '已完成' : s.status}
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
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


