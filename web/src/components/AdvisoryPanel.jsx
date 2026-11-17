import { useEffect, useRef, useState } from 'react'
import { postAdvisory } from '../api'
import { fmtDay, fmtNum } from '../lib/heat'

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'mr', label: 'मराठी' },
  { code: 'hi', label: 'हिंदी' },
]

const PROVIDER_TEXT = {
  groq: 'Written by an LLM on Groq',
  gemini: 'Written by Google Gemini (fallback)',
  template: 'Fixed template (no LLM was available)',
}

// Public advisory in 3 languages. Each language is fetched once, then kept in memory.
export default function AdvisoryPanel() {
  const [lang, setLang] = useState('en')
  const [attempt, setAttempt] = useState(0) // bumped by "Try again"
  const [view, setView] = useState({ status: 'loading', data: null, error: null })
  const cache = useRef({}) // { en: response, mr: response, ... } so we ask the LLM once per language

  useEffect(() => {
    const hit = cache.current[lang]
    if (hit) {
      setView({ status: 'done', data: hit, error: null })
      return
    }
    let cancelled = false // ignore answers that arrive after the user switched language
    setView({ status: 'loading', data: null, error: null })
    postAdvisory(lang)
      .then((res) => {
        cache.current[lang] = res
        if (!cancelled) setView({ status: 'done', data: res, error: null })
      })
      .catch((error) => !cancelled && setView({ status: 'error', data: null, error }))
    return () => {
      cancelled = true
    }
  }, [lang, attempt])

  const advisory = view.data

  return (
    <div>
      {/* Language toggle: a group of buttons, the active one is "pressed" */}
      <div role="group" aria-label="Advisory language" className="inline-flex rounded border border-line bg-haze p-0.5">
        {LANGS.map((l) => (
          <button
            key={l.code}
            type="button"
            lang={l.code}
            aria-pressed={lang === l.code}
            onClick={() => setLang(l.code)}
            className={`rounded-sm px-4 py-1.5 text-sm font-semibold transition-colors ${
              lang === l.code ? 'bg-ink text-white' : 'text-ink hover:bg-white'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="mt-4 min-h-28" aria-live="polite">
        {view.status === 'loading' && <p className="text-sm text-ink-soft">Writing the advisory…</p>}

        {view.status === 'error' && (
          <div role="alert">
            <p className="text-sm">Couldn't get the advisory. {view.error.message}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-3 rounded border border-sea px-3 py-1.5 text-sm font-semibold text-sea hover:bg-sea/5"
            >
              Try again
            </button>
          </div>
        )}

        {advisory && (
          <>
            <p lang={advisory.lang} className="max-w-[70ch] text-lg leading-relaxed whitespace-pre-line">
              {advisory.text}
            </p>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-sm text-ink-soft">
              <span>
                {PROVIDER_TEXT[advisory.provider] ?? advisory.provider}
                {advisory.model && <> ({advisory.model})</>}
              </span>
              {advisory.inputs_used && <InputsUsed inputs={advisory.inputs_used} />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Shows exactly which numbers the LLM was given. It may not use any others.
function InputsUsed({ inputs }) {
  const parts = [
    inputs.date && fmtDay(inputs.date),
    inputs.alert_level && inputs.alert_level.replace(/_/g, ' '),
    inputs.heat_index_c != null && `heat index ${fmtNum(inputs.heat_index_c, 1)}°C`,
    inputs.top_wards?.length && `wards ${inputs.top_wards.join(', ')}`,
  ].filter(Boolean)
  return <span>Facts given to the writer: {parts.join('; ')}</span>
}
