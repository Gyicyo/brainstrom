import { useParams, useNavigate } from 'react-router-dom'
import { useSession } from '../hooks/useSession'
import { endSession } from '../api/client'
import ChatRoom from '../components/ChatRoom'

export default function SessionView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const sessionId = Number(id)

  const {
    roundDetail, respondingAgentId, loading, error,
    handleStartRound, handleEndRound, handleMention,
  } = useSession(sessionId)

  const handleEndSession = async () => {
    if (!confirm('End this session and generate final report?')) return
    try {
      await endSession(sessionId)
      navigate('/')
    } catch (e) {
      console.error(e)
    }
  }

  const session = roundDetail?.session

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>{session?.topic || 'Brainstorm Session'}</h1>
          {session && (
            <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
              Round {session.current_round} · {session.status}
            </div>
          )}
        </div>
        <button onClick={handleEndSession}
          style={{ padding: '8px 16px', background: '#f44336', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          End Session
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#ffebee', color: '#c62828', borderRadius: 4, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <ChatRoom
        roundDetail={roundDetail}
        onSendMention={handleMention}
        onStartRound={handleStartRound}
        onEndRound={handleEndRound}
        respondingAgentId={respondingAgentId}
        loading={loading}
      />
    </div>
  )
}
