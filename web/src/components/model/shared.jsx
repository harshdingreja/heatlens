import { useEffect, useRef, useState } from 'react'

// Mounts its children only when they scroll near the screen, so the heavy charts
// (hundreds of points each) don't all render at page load.
export function LazyMount({ minHeight = 320, children }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (visible || !ref.current) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '600px 0px' }, // start a little before it's on screen
    )
    io.observe(ref.current)
    return () => io.disconnect()
  }, [visible])

  return (
    <div ref={ref} className="min-w-0" style={visible ? undefined : { minHeight }}>
      {visible ? children : null}
    </div>
  )
}

// Segmented buttons (used for the lead-time selector)
export function Segmented({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap rounded border border-line bg-haze p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-sm px-3 py-1 text-sm font-semibold tabular transition-colors ${
            value === o.value ? 'bg-ink text-white' : 'text-ink hover:bg-white'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// A short explanatory paragraph under a chart
export function Note({ children, className = '' }) {
  return <p className={`max-w-[75ch] text-sm text-ink-soft ${className}`}>{children}</p>
}
