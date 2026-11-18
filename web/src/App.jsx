import { Suspense, lazy, useEffect, useState } from 'react'
import { methodLabel, modelName } from './lib/model'
import { USE_MOCK, getForecast, getModel, getRisk, getWards } from './api'
import { useApi } from './lib/useApi'
import AdvisoryPanel from './components/AdvisoryPanel'
import Footer from './components/Footer'
import ForecastChart from './components/ForecastChart'
import Header from './components/Header'
import HeroGauge from './components/HeroGauge'
import HeatCalculator from './components/HeatCalculator'
import HeatCalendar from './components/HeatCalendar'
import RiskChecker from './components/RiskChecker'
import WardRiskSection from './components/WardRiskSection'
import MethodSection from './components/MethodSection'
import NavBar from './components/NavBar'
import { Panel, Status } from './components/Panel'
import RiskCard from './components/RiskCard'
import SafeBoundary from './components/SafeBoundary'

// The model section is big (many charts), so it is loaded as a separate file only when needed.
const ModelPerformance = lazy(() => import('./components/ModelPerformance'))

// Each section is shown on its own "page": the user reads it, then clicks Next to move on.
// The open section lives in the URL hash (#forecast, ...) so links and the browser's Back button work.
const SECTIONS = [
  { id: 'ward-risk', title: 'Mumbai heat risk by ward', short: 'Ward map' },
  { id: 'forecast', title: 'Heat index forecast', short: 'Forecast' },
  { id: 'health', title: 'Health impact', short: 'Health impact' },
  { id: 'performance', title: 'Model evaluation', short: 'Model evaluation' },
  { id: 'history', title: 'Observed heat record', short: 'Heat record' },
  { id: 'tools', title: 'Tools', short: 'Tools' },
  { id: 'advisory-section', title: 'Public advisory', short: 'Advisory' },
  { id: 'method', title: 'Method and data', short: 'Method' },
]
const fromHash = () => {
  const h = decodeURIComponent(window.location.hash.slice(1))
  return SECTIONS.some((x) => x.id === h) ? h : SECTIONS[0].id
}

export default function App() {
  const forecast = useApi(getForecast)
  const wards = useApi(getWards)
  const risk = useApi(getRisk)
  const model = useApi(getModel) // /model is large: fetched once here, passed down
  const [episodeStart, setEpisodeStart] = useState(null) // heatwave picked in the calendar
  const [active, setActive] = useState(fromHash)

  // Keep the open section in sync with the URL (Back/Forward buttons, pasted links)
  useEffect(() => {
    const onHash = () => {
      setActive(fromHash())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (id) => {
    if (id !== active) window.location.hash = id // triggers hashchange -> setActive
    window.scrollTo({ top: 0 })
  }

  // Calendar click -> open the Model evaluation page at that heatwave's case study
  const openEpisode = (start) => {
    setEpisodeStart(start)
    go('performance')
    const tryScroll = (n) => {
      const el = document.getElementById('heatwaves')
      if (el) el.scrollIntoView({ behavior: 'smooth' })
      else if (n > 0) setTimeout(() => tryScroll(n - 1), 300) // charts load lazily
    }
    setTimeout(() => tryScroll(10), 300)
  }

  const corrector = forecast.data?.corrector ? methodLabel(forecast.data.corrector) : 'ML'
  const i = SECTIONS.findIndex((x) => x.id === active)
  const prev = SECTIONS[i - 1]
  const next = SECTIONS[i + 1]

  const content = {
    'ward-risk': {
      intro: '24 BMC wards coloured by heat risk for the selected day. Click a ward for details.',
      body: (
        <Panel id="wards" title="Ward risk map">
          {wards.data ? (
            <SafeBoundary name="ward map"><WardRiskSection wards={wards.data} days={forecast.data?.days} /></SafeBoundary>
          ) : (
            <Status {...wards} onRetry={wards.reload} what="the ward map" />
          )}
        </Panel>
      ),
    },
    forecast: {
      intro: `Next 5 days at Santacruz: the raw ${forecast.data ? modelName(forecast.data.forecast_model) : 'weather model'} forecast and the ML-corrected value, with NOAA and IMD alert levels.`,
      body: (
        <>
          <SafeBoundary name="forecast gauge"><HeroGauge state={forecast} /></SafeBoundary>
          <Panel id="chart" title="Raw vs corrected forecast" aside="Daily maximum heat index, °C">
            {forecast.data ? (
              <>
                <ForecastChart days={forecast.data.days} />
                <p className="mt-3 max-w-[70ch] text-sm text-ink-soft">
                  Raw: the {modelName(forecast.data.forecast_model)} model's forecast for Santacruz. Corrected: after the {corrector} model, trained on that
                  model's past errors at this station.
                </p>
              </>
            ) : (
              <Status {...forecast} onRetry={forecast.reload} what="the forecast" />
            )}
          </Panel>
        </>
      ),
    },
    health: {
      intro: 'Expected extra deaths if the forecast meets the heatwave definition from Environment International (2024). An evidence-based estimate, not a clinical prediction.',
      body: (
        <Panel id="risk" title="Estimated extra deaths">
          {risk.data ? <RiskCard risk={risk.data} /> : <Status {...risk} onRetry={risk.reload} what="the death-risk estimate" />}
        </Panel>
      ),
    },
    performance: {
      intro: 'Trained on 2024–2025, tested on 2026 data the model never saw. Every number is read from the saved results.',
      body: model.data ? (
        <Suspense fallback={<p className="text-sm text-ink-soft">Loading charts…</p>}>
          <SafeBoundary name="model performance"><ModelPerformance report={model.data} episodeStart={episodeStart} /></SafeBoundary>
        </Suspense>
      ) : (
        <Panel title="Model report">
          <Status {...model} onRetry={model.reload} what="the model report" />
        </Panel>
      ),
    },
    history: {
      intro: 'Daily maximum heat index measured at Santacruz, one year at a time. Click an outlined heatwave to open its case study.',
      body: (
        <Panel id="calendar" title="Station record">
          {model.data?.heat_calendar ? (
            <SafeBoundary name="heat calendar"><HeatCalendar days={model.data.heat_calendar} episodes={model.data.heatwave_history?.episodes} onEpisode={openEpisode} /></SafeBoundary>
          ) : (
            <Status {...model} onRetry={model.reload} what="the heat record" />
          )}
        </Panel>
      ),
    },
    tools: {
      intro: 'Check personal risk for tomorrow, or see how temperature and humidity combine into the heat index.',
      body: (
        <div className="grid min-w-0 gap-5 sm:gap-6">
          <Panel id="checker" title="Personal risk check">
            {forecast.loading ? <Status loading what="the forecast" /> : <SafeBoundary name="risk checker"><RiskChecker days={forecast.data?.days} wards={wards.data} /></SafeBoundary>}
          </Panel>
          <Panel id="calculator" title="Heat index calculator" aside="NOAA formula, same as the models">
            <SafeBoundary name="calculator"><HeatCalculator /></SafeBoundary>
          </Panel>
        </div>
      ),
    },
    'advisory-section': {
      intro: 'Generated in English, Marathi and Hindi from the forecast, using only the numbers given to it.',
      body: (
        <Panel id="advisory" title="Advisory">
          <AdvisoryPanel />
        </Panel>
      ),
    },
    method: { intro: null, body: <MethodSection /> },
  }

  return (
    <>
      {USE_MOCK && (
        <div role="note" className="bg-heat-yellow px-4 py-2 text-center text-sm font-bold text-ink">
          SAMPLE DATA: a saved snapshot of the HeatLens API from 18 Nov 2026, not live.
        </div>
      )}
      <NavBar sections={SECTIONS} active={active} onGo={go} />

      <div id="top" className="mx-auto max-w-6xl px-4 sm:px-6">
        <Header forecast={forecast.data} />
      </div>

      <main className="min-w-0">
        <Section n={i + 1} total={SECTIONS.length} id={active} title={SECTIONS[i].title} intro={content[active].intro}>
          {content[active].body}
          <Pager prev={prev} next={next} onGo={go} />
        </Section>
      </main>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Footer />
      </div>
    </>
  )
}

// Bottom of every section: an explicit step to the previous / next section.
function Pager({ prev, next, onGo }) {
  return (
    <nav aria-label="Section navigation" className="mt-4 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
      {prev ? (
        <button type="button" onClick={() => onGo(prev.id)} className="rounded-md border border-line bg-white p-4 text-left hover:border-sea">
          <span className="block text-xs font-semibold tracking-wide text-ink-soft uppercase">← Back</span>
          <span className="block font-bold">{prev.title}</span>
        </button>
      ) : (
        <span className="hidden sm:block" />
      )}
      {next && (
        <button type="button" onClick={() => onGo(next.id)} className="rounded-md bg-sea p-4 text-left text-white hover:bg-ink sm:text-right">
          <span className="block text-xs font-semibold tracking-wide text-white/80 uppercase">Next →</span>
          <span className="block text-lg font-bold">{next.title}</span>
        </button>
      )}
    </nav>
  )
}

// The open section: numbered heading ("3 of 8"), intro, then its content.
function Section({ n, total, id, title, intro, children }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="min-w-0 border-t border-line bg-haze pt-8 pb-14">
      <div className="mx-auto flex max-w-6xl min-w-0 flex-col gap-5 px-4 sm:gap-6 sm:px-6">
        <div className="border-l-4 border-sea pl-4">
          <p className="text-sm font-bold tracking-widest text-sea tabular">
            {String(n).padStart(2, '0')} <span className="font-semibold text-ink-soft">of {String(total).padStart(2, '0')}</span>
          </p>
          <h2 id={`${id}-heading`} className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            {title}
          </h2>
          {intro && <p className="mt-1 max-w-[75ch] text-ink-soft">{intro}</p>}
        </div>
        {children}
      </div>
    </section>
  )
}
