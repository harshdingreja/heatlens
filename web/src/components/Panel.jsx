// A white panel with a heading. Used by every dashboard section.
export function Panel({ title, aside, children, className = '', id }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={`rounded-md border border-line bg-surface ${className}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3 sm:px-5">
        <h2 id={id ? `${id}-title` : undefined} className="text-lg font-bold leading-tight">
          {title}
        </h2>
        {aside && <div className="text-sm text-ink-soft">{aside}</div>}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  )
}

// Loading and error messages for one section.
// `what` names the data, e.g. "the forecast", so the message says exactly what failed.
export function Status({ loading, slow, error, onRetry, what, dark = false }) {
  const soft = dark ? 'text-white/75' : 'text-ink-soft'
  if (loading) {
    return (
      <p className={`py-6 text-sm ${soft}`} role="status">
        Loading {what}…
        {slow && ' The free API server sleeps when idle and can take up to a minute to wake up.'}
      </p>
    )
  }
  if (error) {
    return (
      <div className="py-4" role="alert">
        <p className={`text-sm ${dark ? 'text-white' : 'text-ink'}`}>
          Couldn't load {what}. {error.message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className={`mt-3 rounded border px-3 py-1.5 text-sm font-semibold ${
            dark ? 'border-white/60 text-white hover:bg-white/10' : 'border-sea text-sea hover:bg-sea/5'
          }`}
        >
          Try again
        </button>
      </div>
    )
  }
  return null
}
