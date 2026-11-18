import { useEffect, useRef, useState } from 'react'

const NAV = [
  { id: 'ward-risk', label: 'Map' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'health', label: 'Health' },
  { id: 'performance', label: 'Evaluation' },
  { id: 'history', label: 'Record' },
  { id: 'tools', label: 'Tools' },
  { id: 'advisory-section', label: 'Advisory' },
  { id: 'method', label: 'Method' },
]

// Sticky top navigation. Highlights the section currently on screen.
export default function NavBar() {
  const [active, setActive] = useState(NAV[0].id)
  const listRef = useRef(null)

  // On phones the link row scrolls sideways: keep the active link visible.
  useEffect(() => {
    const list = listRef.current
    const link = list?.querySelector(`[href="#${active}"]`)
    if (list && link) list.scrollTo({ left: link.offsetLeft - 16, behavior: 'smooth' })
  }, [active])

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (hit) setActive(hit.target.id)
      },
      { rootMargin: '-80px 0px -60% 0px' }, // "active" = the section near the top of the screen
    )
    NAV.forEach((n) => {
      const el = document.getElementById(n.id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [])

  return (
    <nav aria-label="Sections" className="sticky top-0 z-30 border-b border-line bg-haze/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 sm:px-6">
        <a href="#top" className="hidden shrink-0 py-3 font-extrabold sm:block">
          HeatLens
        </a>
        <ul ref={listRef} className="relative -mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto py-1.5 [scrollbar-width:none] sm:justify-end">
          {NAV.map((n) => (
            <li key={n.id} className="shrink-0">
              <a
                href={`#${n.id}`}
                aria-current={active === n.id ? 'true' : undefined}
                className={`block rounded-sm px-2.5 py-1.5 text-sm font-semibold whitespace-nowrap ${
                  active === n.id ? 'bg-ink text-white' : 'text-ink-soft hover:bg-white hover:text-ink'
                }`}
              >
                {n.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
