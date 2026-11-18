import { useRef } from 'react'
import { useInView, useTween } from '../lib/anim'

// A number that counts up from 0 when it scrolls into view
export default function CountUp({ value, digits = 0, suffix = '', className = '' }) {
  const ref = useRef(null)
  const seen = useInView(ref)
  const v = useTween(seen ? value : 0, 1100)
  return (
    <span ref={ref} className={className}>
      {(seen ? v : 0).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}
      {suffix}
    </span>
  )
}
