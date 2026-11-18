// HeatLens mark: a lens (ring) looking at a heat hotspot (warm contours, hottest in the middle).
// Same drawing as public/favicon.svg.
export default function Logo({ size = 36, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className={`shrink-0 ${className}`}>
      <circle cx="20" cy="20" r="17" fill="#fde3a4" />
      <circle cx="21.5" cy="21.5" r="12" fill="#f9a854" />
      <circle cx="22.5" cy="22.5" r="7.5" fill="#e45e30" />
      <circle cx="23" cy="23" r="3.5" fill="#a1262a" />
      <circle cx="20" cy="20" r="17" fill="none" stroke="#0e2a3b" strokeWidth="3" />
      {/* light glint on the glass */}
      <path d="M10.5 15.5 A10.5 10.5 0 0 1 16 9.8" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity="0.9" />
    </svg>
  )
}
