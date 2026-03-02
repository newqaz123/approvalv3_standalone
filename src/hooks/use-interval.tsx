'use client'

import { useEffect, useRef } from 'react'

interface UseIntervalProps {
  callback: () => void
  delay: number | null // null pauses the interval
}

/**
 * Custom hook for setInterval with proper cleanup
 * Handles pause/resume by setting delay to null
 */
export function useInterval({ callback, delay }: UseIntervalProps): void {
  const savedCallback = useRef<(() => void) | undefined>(undefined)

  // Remember the latest callback
  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  // Set up the interval
  useEffect(() => {
    if (delay === null) {
      // Paused - don't set up interval
      return
    }

    const tick = () => {
      savedCallback.current?.()
    }

    const id = setInterval(tick, delay)

    // Cleanup function
    return () => clearInterval(id)
  }, [delay])
}
