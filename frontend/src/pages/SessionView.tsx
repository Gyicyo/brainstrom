import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useSession } from '../hooks/useSession'
import ChatRoom from '../components/ChatRoom'

function getPhaseLabel(roundDetail: NonNullable<ReturnType<typeof useSession>['roundDetail']>): string {
  const round = roundDetail.current_round
  if (round.scribe_summary) return `Round ${round.round_number} · Ended`
  if (round.private_threads.length > 0) return `Round ${round.round_number} · Mention Phase`
  if (round.public_messages.length > 0) return `Round ${round.round_number} · Divergent Phase`
  return `Round ${round.round_number} · Starting`
}

function SummaryCard({ summary }: { summary: { round_number: number; summary: string; created_at: string } }) {
  const [expanded, setExpanded] = useState(false)
  const preview = summary.summary.length > 120 ? summary.summary.slice(0, 120) + '...' : summary.summary
  return (
    <div onClick={() => setExpanded(!expanded)}
      style={{
        padding: '10px 16px', borderBottom: '1px solid var(--border)',
        cursor: 'pointer', transition: 'background 0.1s',
      }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', marginBottom: 4 }}>
        Round {summary.round_number} · {new Date(summary.created_at).toLocaleDateString()}
      </div>
      <div style={{
        fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {expanded ? summary.summary : preview}
      </div>
    </div>
  )
}

export default function SessionView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const sessionId = Number(id)

  const {
    roundDetail, respondingAgentId, loading, error,
    streamingAgentIds, streamContents, isStreaming, searchStatus,
    handleCreateRound, handleStartDivergent, handleStartNextRound,
    handleEndRound, handleMention, handleEndSession, handleDeleteSession,
    fetchSummaries,
  } = useSession(sessionId)

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [summaries, setSummaries] = useState<{ round_number: number; summary: string; created_at: string }[]>([])

  useEffect(() => {
    if (sidebarOpen) {
      fetchSummaries().then(setSummaries).catch(() => {})
    }
  }, [sidebarOpen, sessionId, fetchSummaries])

  const endSession = async () => {
    if (!confirm('End this session and generate final report?')) return
    try {
      await handleEndSession()
      navigate('/')
    } catch (e) {
      console.error(e)
    }
  }

  const deleteCurrent = async () => {
    if (!confirm('Delete this session and all its data?')) return
    try {
      await handleDeleteSession()
      navigate('/')
    } catch (e) {
      console.error(e)
    }
  }

  const session = roundDetail?.session
  const phaseLabel = roundDetail ? getPhaseLabel(roundDetail) : null

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 100px)', gap: 0 }}>
      {/* Left sidebar */}
      <div style={{
        display: 'flex', flexDirection: 'column',
        borderRight: sidebarOpen ? '1px solid var(--border)' : 'none',
        transition: 'width 0.2s', width: sidebarOpen ? 240 : 0, overflow: 'hidden',
        flexShrink: 0,
      }}>
        <div style={{
          width: 240, height: '100%', display: 'flex', flexDirection: 'column',
          background: 'var(--surface)', overflowY: 'auto',
        }}>
          <div style={{
            padding: '12px 16px', fontSize: 14, fontWeight: 600,
            borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            Round Summaries
            <button onClick={() => setSidebarOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)' }}>
              ✕
            </button>
          </div>
          {summaries.length === 0 ? (
            <p style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
              No summaries yet
            </p>
          ) : (
            summaries.map(s => (
              <SummaryCard key={s.round_number} summary={s} />
            ))
          )}
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, padding: '0 0 0 16px' }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          marginBottom: 16, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setSidebarOpen(!sidebarOpen)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 18, padding: '4px 8px', borderRadius: 'var(--radius)',
                color: 'var(--text-secondary)',
              }}>
              ☰
            </button>
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
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={deleteCurrent}
              style={{
                padding: '8px 16px', background: 'transparent', color: 'var(--text-secondary)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer',
                fontSize: 13, fontWeight: 500, flexShrink: 0,
              }}>
              Delete
            </button>
            <button onClick={endSession}
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
            searchStatus={searchStatus}
          />
        </div>
      </div>
    </div>
  )
}
