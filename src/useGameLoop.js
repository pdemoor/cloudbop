import { useEffect, useRef } from 'react'

export function useGameLoop(callback) {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    let rafId
    let last = performance.now()

    function tick(now) {
      const dt = now - last
      last = now
      cbRef.current(dt, now)
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])
}
