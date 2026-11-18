import { Panel } from './Panel'

// How HeatLens works, as a pipeline, plus where each ML capability lives in the code.
const STAGES = [
  {
    title: 'Data',
    items: ['GHCNh station observations (Santacruz, Colaba)', 'ERA5 reanalysis, 1991 onwards', '4-model forecast archive (ICON, GFS, ECMWF, JMA)', 'Landsat surface temperature + NDVI', 'Census 2011 ward data'],
  },
  { title: 'Features', items: ['Heat index (NOAA) and WBGT', '1991–2020 climate normal per date', 'Recent forecast error, season, lead time'] },
  {
    title: 'Models',
    items: ['Forecast corrector (linear + LightGBM)', 'NOAA / IMD alert levels', 'Anomalies: z-score + IsolationForest', 'Ward HVI + k-means', 'Health: published RR + Poisson / NB'],
  },
  { title: 'FastAPI', items: ['/forecast', '/wards', '/risk', '/model', '/advisory'] },
  { title: 'Dashboard + LLM', items: ['This page (React)', 'Advisories in English, Marathi, Hindi (Groq, Gemini fallback)'] },
]

const CAPABILITIES = [
  ['Forecasting', 'Heat stress 1–5 days ahead', 'models/corrector.py'],
  ['Regression', 'Correcting the raw forecast; state health model', 'models/corrector.py, models/state_health.py'],
  ['Classification', 'Alert level green to red', 'models/alerts.py'],
  ['Anomaly detection', 'Unusually hot for the date', 'models/anomaly.py'],
  ['Clustering', 'Wards grouped by vulnerability', 'models/vulnerability.py'],
  ['Explainability', 'SHAP on the corrector', 'models/corrector.py'],
  ['Geospatial + satellite', 'Land surface temperature and NDVI per ward', 'ingest/satellite.py, ingest/wards.py'],
  ['GenAI', 'Multilingual advisories, numbers checked', 'llm/advisory.py'],
]

export default function MethodSection() {
  return (
    <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
      <Panel id="pipeline" title="From raw data to a warning">
        <ol className="grid min-w-0 gap-3 md:grid-cols-5 md:gap-0">
          {STAGES.map((s, i) => (
            <li key={s.title} className="relative flex min-w-0 md:pr-6">
              <div className="w-full min-w-0 rounded border border-line bg-haze/60 p-3">
                <p className="text-sm text-ink-soft tabular">Step {i + 1}</p>
                <h3 className="font-bold leading-tight">{s.title}</h3>
                <ul className="mt-2 space-y-1 text-sm leading-snug">
                  {s.items.map((it) => (
                    <li key={it} className="break-words">
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
              {i < STAGES.length - 1 && <Arrow />}
            </li>
          ))}
        </ol>
      </Panel>

      <Panel id="capabilities" title="Eight ML capabilities, and where they live" aside="Paths under src/heatlens/">
        <dl className="grid min-w-0 gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map(([name, what, file]) => (
            <div key={name} className="min-w-0 bg-surface p-3">
              <dt className="font-bold">{name}</dt>
              <dd className="text-sm text-ink-soft">{what}</dd>
              <dd className="mt-1.5 break-words font-semibold text-sea text-sm">{file}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  )
}

// Arrow between stages: points right on wide screens, down on phones.
function Arrow() {
  return (
    <>
      <svg aria-hidden="true" className="absolute top-1/2 right-0.5 hidden h-4 w-5 -translate-y-1/2 md:block" viewBox="0 0 20 16">
        <path d="M1 8h15M11 3l5 5-5 5" fill="none" stroke="#4a6070" strokeWidth="2" />
      </svg>
      <svg aria-hidden="true" className="absolute -bottom-3 left-1/2 h-3 w-4 -translate-x-1/2 md:hidden" viewBox="0 0 16 12">
        <path d="M8 0v9M3 6l5 5 5-5" fill="none" stroke="#4a6070" strokeWidth="2" />
      </svg>
    </>
  )
}
