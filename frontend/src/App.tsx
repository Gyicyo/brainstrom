import { Routes, Route, Link } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import SessionView from './pages/SessionView'
import LLMConfig from './pages/LLMConfig'

function App() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <nav style={{
        background: 'var(--surface)', padding: '12px 24px',
        borderBottom: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex', gap: 24, alignItems: 'center',
      }}>
        <Link to="/" style={{ fontWeight: 700, textDecoration: 'none', color: 'var(--primary)', fontSize: 16 }}>
          Brainstorm
        </Link>
        <Link to="/settings" style={{ textDecoration: 'none', color: 'var(--text-secondary)', fontSize: 14 }}>
          LLM 设置
        </Link>
      </nav>
      <main style={{ maxWidth: 1200, margin: '24px auto', padding: '0 16px' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/session/:id" element={<SessionView />} />
          <Route path="/settings" element={<LLMConfig />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
