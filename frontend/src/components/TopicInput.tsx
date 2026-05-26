import { useState } from 'react'

interface Props {
  onSubmit: (topic: string) => void;
}

export default function TopicInput({ onSubmit }: Props) {
  const [text, setText] = useState('')

  const handleSubmit = () => {
    if (!text.trim()) return
    onSubmit(text.trim())
    setText('')
  }

  return (
    <div style={{ background: '#fff', padding: 16, borderRadius: 8, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>你想讨论什么？</h3>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="输入你的主题..."
          style={{ flex: 1, padding: '10px 12px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14 }}
        />
        <button onClick={handleSubmit}
          style={{ padding: '10px 20px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          开始
        </button>
      </div>
    </div>
  )
}
