import { useState, useEffect } from 'react'

const STORAGE_KEY = 'brainstorm-llm-config'

export interface LLMConfigType {
  baseUrl: string
  apiKey: string
  modelName: string
}

export function loadLLMConfig(): LLMConfigType {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', modelName: 'deepseek-v4-flash' }
}

export function saveLLMConfig(config: LLMConfigType) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

type TestResults = {
  directStreamSimple: {
    elapsedMs: number
    eventTypes: string[]
    response: string
    error: string | null
  } | null
  basic: { elapsedMs: number; response: string } | null
  toolCall: {
    elapsedMs: number
    toolExecutionStartEvents: { name: string; args: any }[]
    toolExecutionEndEvents: { name: string; isError: boolean; result: any }[]
    finalResponse: string
    toolWasCalled: boolean
  } | null
  error: { message: string; stack: string } | null
}

export default function LLMConfig() {
  const [config, setConfig] = useState<LLMConfigType>(loadLLMConfig)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [results, setResults] = useState<TestResults | null>(null)

  useEffect(() => {
    setSaved(false)
    setResults(null)
  }, [config])

  const handleSave = () => {
    saveLLMConfig(config)
    setSaved(true)
  }

  const handleTest = async () => {
    saveLLMConfig(config)
    setTesting(true)
    setResults(null)
    try {
      const resp = await fetch('http://localhost:3001/api/test-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiConfig: { apiBaseUrl: config.baseUrl, apiKey: config.apiKey, modelName: config.modelName },
        }),
      })
      if (!resp.ok) throw new Error(`Bridge error ${resp.status}: ${await resp.text()}`)
      const data = await resp.json()
      setResults(data)
    } catch (err: any) {
      setResults({ directStreamSimple: null, basic: null as any, toolCall: null as any, error: { message: err.message, stack: err.stack } })
    }
    setTesting(false)
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 24px', fontSize: 22, fontWeight: 700 }}>LLM 全局设置</h1>
      <div style={{
        background: 'var(--surface)', padding: 24, borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow)', border: '1px solid var(--border)',
      }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          所有讨论 Agent、书记官和蒸馏功能共用此 LLM 配置。
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input placeholder="API 接口地址" value={config.baseUrl}
            onChange={e => setConfig(c => ({ ...c, baseUrl: e.target.value }))}
            style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, outline: 'none' }} />
          <input placeholder="API 密钥" type="password" value={config.apiKey}
            onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))}
            style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, outline: 'none' }} />
          <input placeholder="模型名称" value={config.modelName}
            onChange={e => setConfig(c => ({ ...c, modelName: e.target.value }))}
            style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, outline: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={handleSave}
              style={{
                padding: '8px 20px', background: 'var(--primary)', color: '#fff',
                border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
                fontSize: 14, fontWeight: 500,
              }}>
              保存
            </button>
            <button onClick={handleTest} disabled={testing || !config.apiKey || !config.baseUrl}
              style={{
                padding: '8px 20px',
                background: testing || !config.apiKey || !config.baseUrl ? '#D1D5DB' : 'var(--bg)',
                color: testing || !config.apiKey || !config.baseUrl ? '#999' : 'var(--text-primary)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                cursor: testing || !config.apiKey || !config.baseUrl ? 'not-allowed' : 'pointer',
                fontSize: 14, fontWeight: 500,
              }}>
              {testing ? '测试中...' : '测试连接'}
            </button>
            {saved && !results && <span style={{ fontSize: 13, color: '#059669' }}>✅ 已保存</span>}
          </div>

          {testing && (
            <div style={{ padding: 12, background: '#FEF3C7', borderRadius: 'var(--radius)', fontSize: 13 }}>
              ⏳ 基础文本测试中...
            </div>
          )}

          {results?.error && (
            <div style={{
              padding: 12, borderRadius: 'var(--radius)',
              background: '#FEF2F2', border: '1px solid #FCA5A5',
              fontSize: 13,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#DC2626' }}>❌ 连接失败</div>
              <div style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{results.error.message}</div>
            </div>
          )}

          {results?.directStreamSimple && (
            <div style={{
              padding: 12, borderRadius: 'var(--radius)',
              background: results.directStreamSimple.error ? '#FEF2F2' : results.directStreamSimple.eventTypes.length > 0 ? '#F0FDF4' : '#FEF3C7',
              border: `1px solid ${results.directStreamSimple.error ? '#FCA5A5' : results.directStreamSimple.eventTypes.length > 0 ? '#86EFAC' : '#FDE68A'}`,
              fontSize: 13,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4, color: results.directStreamSimple.error ? '#DC2626' : '#059669' }}>
                📡 直接 streamSimple 测试（{results.directStreamSimple.elapsedMs}ms）
                {results.directStreamSimple.error ? ` — ${results.directStreamSimple.error}` : ''}
              </div>
              {results.directStreamSimple.eventTypes.length > 0 && (
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#666', marginBottom: 4 }}>
                  事件序列: {results.directStreamSimple.eventTypes.join(' → ')}
                </div>
              )}
              <div style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', background: '#fff', padding: 8, borderRadius: 4, marginTop: 4 }}>
                {results.directStreamSimple.response || '(空响应)'}
              </div>
            </div>
          )}

          {results?.basic && (
            <div style={{
              padding: 12, borderRadius: 'var(--radius)',
              background: '#F0FDF4', border: '1px solid #86EFAC',
              fontSize: 13,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#059669' }}>
                ✅ 基础 LLM 调用成功（{results.basic.elapsedMs}ms）
              </div>
              <div style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', background: '#fff', padding: 8, borderRadius: 4, marginTop: 4 }}>
                {results.basic.response}
              </div>
            </div>
          )}

          {results?.toolCall && (
            <div style={{
              padding: 12, borderRadius: 'var(--radius)',
              background: results.toolCall.toolWasCalled ? '#F0FDF4' : '#FEF3C7',
              border: `1px solid ${results.toolCall.toolWasCalled ? '#86EFAC' : '#FDE68A'}`,
              fontSize: 13,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4, color: results.toolCall.toolWasCalled ? '#059669' : '#92400E' }}>
                🔧 工具调用测试（{results.toolCall.elapsedMs}ms）
                {results.toolCall.toolWasCalled ? ` — ${results.toolCall.toolExecutionStartEvents.length} 个工具被调用` : ' — 未触发工具调用'}
              </div>

              {results.toolCall.toolExecutionStartEvents.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontWeight: 500, marginBottom: 2, color: '#666' }}>▶ tool_execution_start 事件</div>
                  {results.toolCall.toolExecutionStartEvents.map((ev, i) => (
                    <div key={i} style={{
                      background: '#fff', padding: '6px 8px', borderRadius: 4,
                      marginTop: 4, fontFamily: 'monospace', fontSize: 12,
                    }}>
                      ▶ <strong>{ev.name}</strong>
                      {ev.args && <span style={{ color: '#666' }}> args={JSON.stringify(ev.args)}</span>}
                    </div>
                  ))}
                </div>
              )}

              {results.toolCall.toolExecutionEndEvents.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 500, marginBottom: 2, color: '#666' }}>✓ tool_execution_end 事件</div>
                  {results.toolCall.toolExecutionEndEvents.map((ev, i) => (
                    <div key={i} style={{
                      background: '#fff', padding: '6px 8px', borderRadius: 4,
                      marginTop: 4, fontFamily: 'monospace', fontSize: 12,
                    }}>
                      ✓ <strong>{ev.name}</strong>
                      {ev.isError ? <span style={{ color: '#DC2626' }}> error</span> : ''}
                      {ev.result?.content && <div style={{ color: '#059669', marginTop: 2 }}>content: {JSON.stringify(ev.result.content)}</div>}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', background: '#fff', padding: 8, borderRadius: 4, marginTop: 6 }}>
                {results.toolCall.finalResponse || '(空响应)'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
