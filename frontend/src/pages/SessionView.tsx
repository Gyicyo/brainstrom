import { useParams, useNavigate } from 'react-router-dom'
import { useSession } from '../hooks/useSession'
import { endSession, deleteSession } from '../api/client'
import ChatRoom from '../components/ChatRoom'

function getPhaseLabel(roundDetail: NonNullable<ReturnType<typeof useSession>['roundDetail']>): string {
  const round = roundDetail.current_round
  if (round.scribe_summary) return `Round ${round.round_number} · Ended`
  if (round.private_threads.length > 0) return `Round ${round.round_number} · Mention Phase`
  if (round.public_messages.length > 0) return `Round ${round.round_number} · Divergent Phase`
  return `Round ${round.round_number} · Starting`
}

export default function SessionView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const sessionId = Number(id)

  const {
    roundDetail, respondingAgentId, loading, error,
    streamingAgentIds, streamContents, isStreaming,
    handleCreateRound, handleStartDivergent, handleStartNextRound,
    handleEndRound, handleMention,
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

  const handleDelete = async () => {
    if (!confirm('Delete this session and all its data?')) return
    try {
      await deleteSession(sessionId)
      navigate('/')
    } catch (e) {
      console.error(e)
    }
  }

  const session = roundDetail?.session
  const phaseLabel = roundDetail ? getPhaseLabel(roundDetail) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 16, flexShrink: 0,
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
            {session?.topic || 'Brainstorm Session'}
          </h1>
          {phaseLabel && (
            <div style={{
              fontSize: 13, color: 'var(--primary)', marginTop: 4, fontWeight: 500,
              display: 'inline-block', background: 'var(--primary-light)',
              padding: '2px 10px', borderRadius: 'var(--radius-full)',
            }}>
              {phaseLabel}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleDelete}
            style={{
              padding: '8px 16px', background: 'transparent', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer',
              fontSize: 13, fontWeight: 500, flexShrink: 0,
            }}>
            Delete
          </button>
          <button onClick={handleEndSession}
            style={{
              padding: '8px 16px', background: 'var(--danger)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
              fontSize: 13, fontWeight: 500, flexShrink: 0,
            }}>
            End Session
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: 12, background: '#FEF2F2', color: 'var(--danger)',
          borderRadius: 'var(--radius)', marginBottom: 16,
          border: '1px solid #FECACA', fontSize: 14, flexShrink: 0,
        }}>
          {error}
        </div>
      )}

      {/* ChatRoom fills remaining height */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatRoom
          roundDetail={roundDetail}
          onSendMention={handleMention}
          onCreateRound={handleCreateRound}
          onStartDivergent={handleStartDivergent}
          onStartNextRound={handleStartNextRound}
          onEndRound={handleEndRound}
          respondingAgentId={respondingAgentId}
          loading={loading}
          streamingAgentIds={streamingAgentIds}
          streamContents={streamContents}
          isStreaming={isStreaming}
        />
      </div>
    </div>
  )
}
