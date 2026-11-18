import { useEffect, useRef, useState } from 'react'

// Animations here are always optional: if the page is hidden or the user prefers reduced
// motion, values jump straight to their final state (so nothing can get "stuck" half-drawn).
export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const canAnimate = () => !reducedMotion() && typeof document !== 'undefined' && document.visibilityState === 'visible'

const ease = (t) => 1 - Math.pow(1 - t, 3) // ease-out cubic

// Smoothly moves a number towards `target` (used by the gauge needle and count-ups).
export function useTween(target, duration = 700) {
  const [value, setValue] = useState(target ?? 0)
  const fromRef = useRef(target ?? 0)
  const valueRef = useRef(target ?? 0)
  useEffect(() => {
    if (target == null || !Number.isFinite(target)) return
    if (!canAnimate()) {
      valueRef.current = target
      setValue(target)
      return
    }
    fromRef.current = valueRef.current
    let raf
    const start = performance.now()
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const v = fromRef.current + (target - fromRef.current) * ease(t)
      valueRef.current = v
      setValue(v)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    // if the tab gets hidden mid-way, finish immediately
    const onHide = () => {
      if (document.visibilityState !== 'visible') {
        cancelAnimationFrame(raf)
        valueRef.current = target
        setValue(target)
      }
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [target, duration])
  return value
}

// true once the element has scrolled into view (stays true)
export function useInView(ref, rootMargin = '0px') {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (seen || !ref.current) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setSeen(true), io.disconnect()), { rootMargin })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [ref, rootMargin, seen])
  return seen
}
