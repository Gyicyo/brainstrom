import { Routes, Route, Link } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import SessionView from './pages/SessionView'
import AgentConfig from './pages/AgentConfig'

function App() {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <nav style={{ background: '#fff', padding: '12px 24px', borderBottom: '1px solid #ddd', display: 'flex', gap: 24 }}>
        <Link to="/" style={{ fontWeight: 'bold', textDecoration: 'none', color: '#333' }}>Brainstorm</Link>
        <Link to="/agents" style={{ textDecoration: 'none', color: '#666' }}>Agent Config</Link>
      </nav>
      <main style={{ maxWidth: 960, margin: '24px auto', padding: '0 16px' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/session/:id" element={<SessionView />} />
          <Route path="/agents" element={<AgentConfig />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
