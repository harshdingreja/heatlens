import { useState } from 'react'
import { fmtDay } from './lib/heat'
import { USE_MOCK, getForecast, getRisk, getWards } from './api'
import { useApi } from './lib/useApi'
import AdvisoryPanel from './components/AdvisoryPanel'
import Footer from './components/Footer'
import ForecastChart from './components/ForecastChart'
import Header from './components/Header'
import HeatRibbon from './components/HeatRibbon'
import { Panel, Status } from './components/Panel'
import RiskCard from './components/RiskCard'
import WardDetails from './components/WardDetails'
import WardMap from './components/WardMap'

// The whole dashboard is one page. Each section loads its own data from the API.
export default function App() {
  const forecast = useApi(getForecast)
  const wards = useApi(getWards)
  const risk = useApi(getRisk)
  const [selectedWard, setSelectedWard] = useState(null)

  return (
    <>
      {USE_MOCK && (
        <div role="note" className="bg-heat-yellow px-4 py-2 text-center text-sm font-bold text-ink">
          SAMPLE DATA: a saved snapshot of the HeatShield API from 18 Nov 2026, not live.
        </div>
      )}

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Header forecast={forecast.data} />

        <main className="flex flex-col gap-5 sm:gap-6">
          <HeatRibbon state={forecast} />

          <Panel
            id="wards"
            title="Where in Mumbai it hurts most"
            aside={wards.data?.meta ? `City hazard used: ${wards.data.meta.hazard_alert?.replace(/_/g, ' ')}, ${fmtDay(wards.data.meta.hazard_date)}` : null}
          >
            {wards.data ? (
              <div className="grid gap-5 lg:grid-cols-3">
                <div className="min-w-0 lg:col-span-2">
                  <WardMap wards={wards.data} selectedId={selectedWard} onSelect={setSelectedWard} />
                </div>
                <WardDetails wards={wards.data} selectedId={selectedWard} onSelect={setSelectedWard} />
              </div>
            ) : (
              <Status {...wards} onRetry={wards.reload} what="the ward map" />
            )}
          </Panel>

          <div className="grid gap-5 sm:gap-6 lg:grid-cols-5">
            <Panel id="chart" title="Raw forecast vs HeatShield correction" className="min-w-0 lg:col-span-3" aside="Daily maximum heat index, °C">
              {forecast.data ? (
                <>
                  <ForecastChart days={forecast.data.days} />
                  <p className="mt-3 max-w-[70ch] text-sm text-ink-soft">
                    The raw line is what the {forecast.data.forecast_model} weather model predicts for Santacruz. The corrected line is
                    after our {forecast.data.corrector ?? 'ML'} model, trained on past forecast errors at this station, adjusts it.
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

          <Panel id="advisory" title="Public advisory" aside="English, Marathi and Hindi">
            <AdvisoryPanel />
          </Panel>
        </main>

        <Footer />
      </div>
    </>
  )
}
