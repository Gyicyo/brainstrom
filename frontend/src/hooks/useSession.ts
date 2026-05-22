import { useState, useEffect, useCallback } from 'react'
import {
  getCurrentRound, startNewRound, endRound, divergentRound, mentionAgent,
} from '../api/client'
import type { RoundDetailType } from '../types'

export function useSession(sessionId: number) {
  const [roundDetail, setRoundDetail] = useState<RoundDetailType | null>(null)
  const [respondingAgentId, setRespondingAgentId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const detail = await getCurrentRound(sessionId)
      setRoundDetail(detail)
    } catch (e: any) {
      // No current round = session just created, that's fine
      setRoundDetail(null)
    }
  }, [sessionId])

  useEffect(() => { load() }, [load])

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
    try {
      const detail = await divergentRound(sessionId, roundDetail.current_round.id)
      setRoundDetail(detail)
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
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
      // Reload to get scribe summary
      await load()
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  const handleMention = async (agentId: number, question: string) => {
    if (!roundDetail) return
    setRespondingAgentId(agentId)
    try {
      const detail = await mentionAgent(sessionId, roundDetail.current_round.id, agentId, question)
      setRoundDetail(detail)
    } catch (e: any) {
      setError(e.message)
    }
    setRespondingAgentId(null)
  }

  return {
    roundDetail, respondingAgentId, loading, error,
    handleCreateRound, handleStartDivergent, handleStartNextRound,
    handleEndRound, handleMention,
  }
}
