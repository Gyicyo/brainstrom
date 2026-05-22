import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getCurrentRound, startNewRound, endRound, divergentRound, mentionAgent,
  streamAgentMessage,
} from '../api/client'
import type { RoundDetailType } from '../types'

export function useSession(sessionId: number) {
  const [roundDetail, setRoundDetail] = useState<RoundDetailType | null>(null)
  const [respondingAgentId, setRespondingAgentId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streamingAgentIds, setStreamingAgentIds] = useState<Set<number>>(new Set())
  const [streamContents, setStreamContents] = useState<Record<number, string>>({})

  // Store streaming cleanup function for unmount
  const cleanupRef = useRef<(() => void) | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const detail = await getCurrentRound(sessionId)
      setRoundDetail(detail)
    } catch (e: any) {
      setRoundDetail(null)
    }
  }, [sessionId])

  useEffect(() => { load() }, [load])

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [])

  const handleCreateRound = async (initialMessage: string) => {
    setLoading(true)
    try {
      const detail = await startNewRound(sessionId, initialMessage)
      setRoundDetail(detail)
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  const handleStartDivergent = async () => {
    if (!roundDetail) return
    setLoading(true)
    setError(null)
    try {
      const detail = await divergentRound(sessionId, roundDetail.current_round.id)
      setRoundDetail(detail)

      // Find the just-created empty agent messages
      const agentMsgs = detail.current_round.public_messages.filter(
        m => !m.is_human && m.agent_id !== null
      )
      const agentIds = new Set(agentMsgs.map(m => m.agent_id!).filter(Boolean))
      setStreamingAgentIds(agentIds)

      const cleanups: (() => void)[] = []
      let done = 0
      const total = agentMsgs.length

      for (const msg of agentMsgs) {
        if (msg.agent_id === null) continue
        const cleanup = streamAgentMessage(sessionId, detail.current_round.id, msg.id, {
          onAgentStart: (data) => {
            setStreamContents(prev => ({ ...prev, [data.agent_id]: '' }))
          },
          onToken: (data) => {
            setStreamContents(prev => ({
              ...prev,
              [data.agent_id]: (prev[data.agent_id] || '') + data.token,
            }))
          },
          onAgentDone: (data) => {
            setStreamContents(prev => {
              const content = prev[data.agent_id] || ''
              if (content) {
                setRoundDetail(current => {
                  if (!current) return current
                  const updatedMessages = current.current_round.public_messages.map(m =>
                    m.agent_id === data.agent_id ? { ...m, content } : m
                  )
                  return {
                    ...current,
                    current_round: { ...current.current_round, public_messages: updatedMessages },
                  }
                })
              }
              const { [data.agent_id]: _, ...rest } = prev
              return rest
            })
            setStreamingAgentIds(prev => {
              const next = new Set(prev)
              next.delete(data.agent_id)
              return next
            })
          },
          onAgentError: (data) => {
            setStreamingAgentIds(prev => {
              const next = new Set(prev)
              next.delete(data.agent_id)
              return next
            })
          },
          onConnectionError: (_messageId, err) => {
            setStreamingAgentIds(prev => {
              const next = new Set(prev)
              next.delete(msg.agent_id!)
              return next
            })
          },
          onComplete: () => {
            done++
            if (done >= total) {
              cleanupRef.current = null
              setStreamingAgentIds(new Set())
              setStreamContents({})
              setLoading(false)
              load()
            }
          },
        })
        cleanups.push(cleanup)
      }

      cleanupRef.current = () => cleanups.forEach(c => c())
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  const handleStartNextRound = async () => {
    setLoading(true)
    try {
      const detail = await startNewRound(sessionId, '')
      setRoundDetail(detail)
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  const handleEndRound = async () => {
    setLoading(true)
    try {
      if (!roundDetail) return
      await endRound(sessionId, roundDetail.current_round.id)
      await load()
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  const handleMention = async (agentIds: number[], question: string) => {
    if (!roundDetail || agentIds.length === 0) return
    setRespondingAgentId(agentIds[0])
    try {
      const detail = await mentionAgent(sessionId, roundDetail.current_round.id, agentIds, question)
      setRoundDetail(detail)
    } catch (e: any) {
      setError(e.message)
    }
    setRespondingAgentId(null)
  }

  const isStreaming = streamingAgentIds.size > 0

  return {
    roundDetail, respondingAgentId, loading, error,
    streamingAgentIds, streamContents, isStreaming,
    handleCreateRound, handleStartDivergent, handleStartNextRound,
    handleEndRound, handleMention,
  }
}
