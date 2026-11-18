import { useEffect, useRef, useState } from 'react'
import Logo from './Logo'

// Top bar: logo + where you are, and a single Menu button that lists every section.
export default function NavBar({ sections, active, onGo }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)
  const i = sections.findIndex((s) => s.id === active)
  const [hidden, setHidden] = useState(false)

  // Hide the bar while scrolling down (so it never covers charts), show it again on scroll up
  useEffect(() => {
    let last = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      if (Math.abs(y - last) < 6) return
      setHidden(y > last && y > 80)
      last = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close the menu whenever the section changes (menu click, Next button, browser Back)
  useEffect(() => setOpen(false), [active])

  // Close the menu on outside click or Escape
  useEffect(() => {
    if (!open) return
    const onClick = (e) => !boxRef.current?.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <nav aria-label="Sections" className={`sticky top-0 z-[1000] border-b border-line bg-haze/95 backdrop-blur-sm transition-transform duration-300 ${hidden && !open ? '-translate-y-full' : ''}`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <button type="button" onClick={() => onGo(sections[0].id)} className="flex min-w-0 items-center gap-2">
          <Logo size={24} />
          <span className="font-extrabold">HeatLens</span>
          <span className="hidden truncate text-sm text-ink-soft sm:inline">
            · {String(i + 1).padStart(2, '0')} {sections[i]?.title}
          </span>
        </button>

        <div ref={boxRef} className="relative">
          <button
            type="button"
            aria-expanded={open}
            aria-haspopup="true"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-semibold hover:border-sea"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Menu
          </button>

          {open && (
            <ul className="absolute right-0 mt-2 w-64 overflow-hidden rounded-md border border-line bg-white py-1 shadow-lg">
              {sections.map((s, k) => (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-current={s.id === active ? 'page' : undefined}
                    onClick={() => {
                      setOpen(false)
                      onGo(s.id)
                    }}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm ${
                      s.id === active ? 'bg-ink font-bold text-white' : 'hover:bg-haze'
                    }`}
                  >
                    <span className={`w-6 tabular ${s.id === active ? 'text-white/70' : 'text-ink-soft'}`}>{String(k + 1).padStart(2, '0')}</span>
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </nav>
  )
}
