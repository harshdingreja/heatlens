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

// The whole dashboard is one page. Each section loads its own data from the API.
export default function App() {
  const forecast = useApi(getForecast)
  const wards = useApi(getWards)
  const risk = useApi(getRisk)
  const model = useApi(getModel) // /model is ~185 KB: fetched once here, passed down
  const [episodeStart, setEpisodeStart] = useState(null) // heatwave picked in the calendar

  // Calendar click -> open that heatwave's case study
  const openEpisode = (start) => {
    setEpisodeStart(start)
    setTimeout(() => document.getElementById('heatwaves')?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  // The model section grows after /model arrives, which pushes later sections down.
  // If the page was opened with a #link, scroll there again once the charts have mounted.
  useEffect(() => {
    if (!model.data || !window.location.hash) return
    const go = () => document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView()
    const timers = [setTimeout(go, 300), setTimeout(go, 1200)] // again after lazy charts have settled
    return () => timers.forEach(clearTimeout)
  }, [model.data])

  const corrector = forecast.data?.corrector ? methodLabel(forecast.data.corrector) : 'ML'

  return (
    <>
      {USE_MOCK && (
        <div role="note" className="bg-heat-yellow px-4 py-2 text-center text-sm font-bold text-ink">
          SAMPLE DATA: a saved snapshot of the HeatLens API from 18 Nov 2026, not live.
        </div>
      )}
      <NavBar />

      <div id="top" className="mx-auto max-w-6xl px-4 sm:px-6">
        <Header forecast={forecast.data} />
      </div>

      <main className="min-w-0">
        <Section n="01" id="ward-risk" title="Mumbai heat risk by ward" intro="24 BMC wards coloured by heat risk for the selected day. Click a ward for details.">
          <Panel id="wards" title="Ward risk map">
            {wards.data ? (
              <SafeBoundary name="ward map"><WardRiskSection wards={wards.data} days={forecast.data?.days} /></SafeBoundary>
            ) : (
              <Status {...wards} onRetry={wards.reload} what="the ward map" />
            )}
          </Panel>
        </Section>

        <Section n="02" id="forecast" title="Heat index forecast" intro={`Next 5 days at Santacruz: the raw ${forecast.data ? modelName(forecast.data.forecast_model) : 'weather model'} forecast and the ML-corrected value, with NOAA and IMD alert levels.`}>
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
        </Section>

        <Section n="03" id="health" title="Health impact" intro="Expected extra deaths if the forecast meets the heatwave definition from Environment International (2024). An evidence-based estimate, not a clinical prediction.">
          <Panel id="risk" title="Estimated extra deaths">
            {risk.data ? <RiskCard risk={risk.data} /> : <Status {...risk} onRetry={risk.reload} what="the death-risk estimate" />}
          </Panel>
        </Section>

        <Section n="04" id="performance" title="Model evaluation" intro="Trained on 2024–2025, tested on 2026 data the model never saw. Every number is read from the saved results.">
          {model.data ? (
            <Suspense fallback={<p className="text-sm text-ink-soft">Loading charts…</p>}>
              <SafeBoundary name="model performance"><ModelPerformance report={model.data} episodeStart={episodeStart} /></SafeBoundary>
            </Suspense>
          ) : (
            <Panel title="Model report">
              <Status {...model} onRetry={model.reload} what="the model report" />
            </Panel>
          )}
        </Section>

        <Section n="05" id="history" title="Observed heat record" intro="Daily maximum heat index measured at Santacruz, one year at a time. Click an outlined heatwave to open its case study above.">
          <Panel id="calendar" title="Station record">
            {model.data?.heat_calendar ? (
              <SafeBoundary name="heat calendar"><HeatCalendar days={model.data.heat_calendar} episodes={model.data.heatwave_history?.episodes} onEpisode={openEpisode} /></SafeBoundary>
            ) : (
              <Status {...model} onRetry={model.reload} what="the heat record" />
            )}
          </Panel>
        </Section>

        <Section n="06" id="tools" title="Tools" intro="Check personal risk for tomorrow, or see how temperature and humidity combine into the heat index.">
          <div className="grid min-w-0 gap-5 sm:gap-6">
            <Panel id="checker" title="Personal risk check">
              {forecast.loading ? <Status loading what="the forecast" /> : <SafeBoundary name="risk checker"><RiskChecker days={forecast.data?.days} wards={wards.data} /></SafeBoundary>}
            </Panel>
            <Panel id="calculator" title="Heat index calculator" aside="NOAA formula, same as the models">
              <SafeBoundary name="calculator"><HeatCalculator /></SafeBoundary>
            </Panel>
          </div>
        </Section>

        <Section n="07" id="advisory-section" title="Public advisory" intro="Generated in English, Marathi and Hindi from the forecast, using only the numbers given to it.">
          <Panel id="advisory" title="Advisory">
            <AdvisoryPanel />
          </Panel>
        </Section>

        <Section n="08" id="method" title="Method and data">
          <MethodSection />
        </Section>
      </main>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Footer />
      </div>
    </>
  )
}

// A numbered, full-width band. Alternating backgrounds and a top rule make it obvious
// where one section ends and the next begins. scroll-mt keeps headings clear of the sticky nav.
function Section({ n, id, title, intro, children }) {
  const odd = Number(n) % 2 === 1
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={`min-w-0 scroll-mt-12 border-t border-line ${n === '01' ? 'pt-6 pb-10 sm:pb-14' : 'py-10 sm:py-14'} ${odd ? 'bg-haze' : 'bg-white'}`}>
      <div className="mx-auto flex max-w-6xl min-w-0 flex-col gap-5 px-4 sm:gap-6 sm:px-6">
        <div className="border-l-4 border-sea pl-4">
          <p className="text-sm font-bold tracking-widest text-sea tabular">{n}</p>
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
