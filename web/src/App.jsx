import { Suspense, lazy, useEffect, useState } from 'react'
import { fmtDay } from './lib/heat'
import { methodLabel, modelName } from './lib/model'
import { USE_MOCK, getForecast, getModel, getRisk, getWards } from './api'
import { useApi } from './lib/useApi'
import AdvisoryPanel from './components/AdvisoryPanel'
import Footer from './components/Footer'
import ForecastChart from './components/ForecastChart'
import Header from './components/Header'
import HeatRibbon from './components/HeatRibbon'
import MethodSection from './components/MethodSection'
import NavBar from './components/NavBar'
import { Panel, Status } from './components/Panel'
import RiskCard from './components/RiskCard'
import WardDetails from './components/WardDetails'
import WardMap from './components/WardMap'

// The model section is big (many charts), so it is loaded as a separate file only when needed.
const ModelPerformance = lazy(() => import('./components/ModelPerformance'))

// The whole dashboard is one page. Each section loads its own data from the API.
export default function App() {
  const forecast = useApi(getForecast)
  const wards = useApi(getWards)
  const risk = useApi(getRisk)
  const model = useApi(getModel) // /model is ~185 KB: fetched once here, passed down
  const [selectedWard, setSelectedWard] = useState(null)

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
          SAMPLE DATA: a saved snapshot of the HeatShield API from 18 Nov 2026, not live.
        </div>
      )}
      <NavBar />

      <div id="top" className="mx-auto max-w-6xl px-4 sm:px-6">
        <Header forecast={forecast.data} />

        <main className="flex min-w-0 flex-col gap-10 sm:gap-14">
          <Section id="forecast" title="Live forecast">
            <HeatRibbon state={forecast} />
            <div className="grid min-w-0 gap-5 sm:gap-6 lg:grid-cols-5">
              <Panel id="chart" title="Raw forecast vs HeatShield correction" className="min-w-0 lg:col-span-3" aside="Daily maximum heat index, °C">
                {forecast.data ? (
                  <>
                    <ForecastChart days={forecast.data.days} />
                    <p className="mt-3 max-w-[70ch] text-sm text-ink-soft">
                      The raw line is what the {modelName(forecast.data.forecast_model)} weather model predicts for Santacruz. The corrected line is
                      after {corrector}, trained on past forecast errors at this station, adjusts it.
                    </p>
                  </>
                ) : (
                  <Status {...forecast} onRetry={forecast.reload} what="the forecast" />
                )}
              </Panel>
              <Panel id="risk" title="Estimated extra deaths" className="min-w-0 lg:col-span-2">
                {risk.data ? <RiskCard risk={risk.data} /> : <Status {...risk} onRetry={risk.reload} what="the death-risk estimate" />}
              </Panel>
            </div>
          </Section>

          <Section id="ward-risk" title="Ward risk">
            <Panel
              id="wards"
              title="Where in Mumbai it hurts most"
              aside={wards.data?.meta ? `City hazard used: ${wards.data.meta.hazard_alert?.replace(/_/g, ' ')}, ${fmtDay(wards.data.meta.hazard_date)}` : null}
            >
              {wards.data ? (
                <div className="grid min-w-0 gap-5 lg:grid-cols-3">
                  <div className="min-w-0 lg:col-span-2">
                    <WardMap wards={wards.data} selectedId={selectedWard} onSelect={setSelectedWard} />
                  </div>
                  <div className="min-w-0">
                    <WardDetails wards={wards.data} selectedId={selectedWard} onSelect={setSelectedWard} />
                  </div>
                </div>
              ) : (
                <Status {...wards} onRetry={wards.reload} what="the ward map" />
              )}
            </Panel>
          </Section>

          <Section
            id="performance"
            title="Model performance"
            intro="Every number below comes from the API's /model report: models trained on 2024–2025 and scored on 2026 data they never saw."
          >
            {model.data ? (
              <Suspense fallback={<p className="text-sm text-ink-soft">Loading charts…</p>}>
                <ModelPerformance report={model.data} />
              </Suspense>
            ) : (
              <Panel title="Model report">
                <Status {...model} onRetry={model.reload} what="the model report" />
              </Panel>
            )}
          </Section>

          <Section id="method" title="Method">
            <MethodSection />
          </Section>

          <Section id="advisory-section" title="Advisory">
            <Panel id="advisory" title="Public advisory" aside="English, Marathi and Hindi">
              <AdvisoryPanel />
            </Panel>
          </Section>
        </main>

        <Footer />
      </div>
    </>
  )
}

// A top-level part of the page: big heading + its panels. scroll-mt keeps it clear of the sticky nav.
function Section({ id, title, intro, children }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex min-w-0 scroll-mt-16 flex-col gap-5 sm:gap-6">
      <div>
        <h2 id={`${id}-heading`} className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          {title}
        </h2>
        {intro && <p className="mt-1 max-w-[75ch] text-ink-soft">{intro}</p>}
      </div>
      {children}
    </section>
  )
}
