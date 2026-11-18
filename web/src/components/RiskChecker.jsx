import { useMemo, useState } from 'react'
import { postAdvisory } from '../api'
import { HEAT_HEX, fmtDay, fmtTemp, riskLabel } from '../lib/heat'
import { riskLevelOf, wardRisk } from '../lib/risk'

// "Am I at risk?": combines tomorrow's alert, the ward's risk, and personal factors into
// plain guidance. Qualitative only: no statistics are invented here.
// Advice follows standard heat-health guidance (NDMA / IMD / WHO heat-health messages).

const AGES = [
  { key: 'child', label: 'Under 5', vulnerable: true },
  { key: 'adult', label: '5–59', vulnerable: false },
  { key: 'senior', label: '60 or older', vulnerable: true },
]
const CONCERN = [
  { label: 'Low concern', color: '#3e8e5e', text: 'Normal summer precautions are enough.' },
  { label: 'Be careful', color: '#e3b023', text: 'Heat can tire you out. Plan the day around the hottest hours.' },
  { label: 'High concern', color: '#e06c1f', text: 'Heat exhaustion is a real risk for you. Change your plans for the afternoon.' },
  { label: 'Very high concern', color: '#b8232e', text: 'Avoid heat exposure as much as you can, and make sure someone checks on you.' },
]
const LANGS = [
  ['en', 'English'],
  ['mr', 'मराठी'],
  ['hi', 'हिंदी'],
]

export default function RiskChecker({ days, wards }) {
  const [age, setAge] = useState('adult')
  const [outdoor, setOutdoor] = useState(false)
  const [condition, setCondition] = useState(false)
  const [wardId, setWardId] = useState('')
  const [adv, setAdv] = useState({ status: 'idle' })

  const tomorrow = days?.[0]
  const ward = wards?.features.find((f) => f.properties.ward_id === wardId)?.properties
  const wardLevel = ward && tomorrow ? riskLevelOf(wardRisk(ward.hvi, tomorrow.alert?.level)) : null

  const result = useMemo(() => {
    if (!tomorrow) return null
    const personal = (AGES.find((a) => a.key === age)?.vulnerable ? 1 : 0) + (outdoor ? 1 : 0) + (condition ? 1 : 0)
    const alertPart = Math.max(0, (tomorrow.alert?.level ?? 0) - 1) // Caution = 0, Ext. caution = 1, Danger = 2, Ext. danger = 3
    const wardPart = wardLevel === 'high' || wardLevel === 'very_high' ? 1 : 0
    const score = alertPart + wardPart + personal
    return CONCERN[Math.min(3, score <= 1 ? 0 : score <= 2 ? 1 : score <= 4 ? 2 : 3)]
  }, [tomorrow, age, outdoor, condition, wardLevel])

  const tips = [
    'Drink water regularly, even if you are not thirsty. ORS, lassi, buttermilk or lemon water also help.',
    'Stay out of direct sun between 12 noon and 3 pm.',
    'Wear light, loose cotton clothes and cover your head outdoors.',
    outdoor && 'Do heavy work early in the morning or in the evening, and take regular breaks in the shade.',
    age === 'senior' && 'Older people feel thirst less: keep water within reach and ask someone to check on you twice a day.',
    age === 'child' && 'Keep small children cool and well fed with fluids, and never leave them in a parked vehicle.',
    condition && 'Heart, kidney, lung conditions, diabetes and some medicines make heat more dangerous: ask your doctor what to do on hot days.',
    'Heat stroke signs: confusion, hot dry skin, fainting, very high body temperature. Call 108 immediately and cool the person with water.',
  ].filter(Boolean)

  const getAdvisory = async (lang) => {
    setAdv({ status: 'loading', lang })
    try {
      setAdv({ status: 'done', lang, data: await postAdvisory(lang) })
    } catch (error) {
      setAdv({ status: 'error', lang, error })
    }
  }

  if (!tomorrow) return <p className="text-sm text-ink-soft">The checker needs the forecast, which hasn't loaded yet.</p>

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      <form className="min-w-0 space-y-4" onSubmit={(e) => e.preventDefault()}>
        <fieldset>
          <legend className="font-semibold">Age</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {AGES.map((a) => (
              <Chip key={a.key} active={age === a.key} onClick={() => setAge(a.key)}>
                {a.label}
              </Chip>
            ))}
          </div>
        </fieldset>
        <Toggle label="I work or travel outdoors during the day" value={outdoor} onChange={setOutdoor} />
        <Toggle label="I have a heart, kidney or lung condition, diabetes, or I'm pregnant" value={condition} onChange={setCondition} />
        <div>
          <label htmlFor="checker-ward" className="font-semibold">
            My ward
          </label>
          <select id="checker-ward" value={wardId} onChange={(e) => setWardId(e.target.value)} className="mt-2 block w-full rounded border border-line bg-surface px-3 py-2">
            <option value="">Choose a ward (optional)</option>
            {wards?.features
              .map((f) => f.properties)
              .sort((a, b) => a.ward_id.localeCompare(b.ward_id))
              .map((p) => (
                <option key={p.ward_id} value={p.ward_id}>
                  {p.ward_name ?? p.ward_id}
                </option>
              ))}
          </select>
        </div>
      </form>

      <div className="min-w-0 rounded-md border-2 p-4" style={{ borderColor: result.color }} aria-live="polite">
        <p className="text-sm text-ink-soft">
          Tomorrow, {fmtDay(tomorrow.date)}: feels like {fmtTemp(tomorrow.heat_index_corrected_c)}C,{' '}
          <span className="font-semibold" style={{ color: HEAT_HEX[tomorrow.alert?.color] }}>
            {tomorrow.alert?.label}
          </span>
          {ward && (
            <>
              {' '}
              · Ward {ward.ward_id}: <strong>{riskLabel(wardLevel)} risk</strong>
            </>
          )}
        </p>
        <p className="mt-2 text-2xl font-extrabold" style={{ color: result.color }}>
          {result.label}
        </p>
        <p className="mt-1">{result.text}</p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">
          {tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-sm font-semibold">Get today's official advisory</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {LANGS.map(([code, label]) => (
              <Chip key={code} lang={code} active={adv.lang === code} onClick={() => getAdvisory(code)}>
                {label}
              </Chip>
            ))}
          </div>
          {adv.status === 'loading' && <p className="mt-2 text-sm text-ink-soft">Writing the advisory…</p>}
          {adv.status === 'error' && <p className="mt-2 text-sm">Couldn't get the advisory. {adv.error.message}</p>}
          {adv.status === 'done' && (
            <p lang={adv.lang} className="mt-2 text-sm whitespace-pre-line">
              {adv.data.text}
            </p>
          )}
        </div>
        <p className="mt-3 text-xs text-ink-soft">A simple guide based on standard heat-health advice. It is not medical advice.</p>
      </div>
    </div>
  )
}

function Chip({ active, children, ...rest }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${active ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:border-ink'}`}
      {...rest}
    >
      {children}
    </button>
  )
}

function Toggle({ label, value, onChange }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span className="font-semibold">{label}</span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={value} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-line transition-colors peer-checked:bg-sea peer-focus-visible:outline-3 peer-focus-visible:outline-sea" />
        <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  )
}
