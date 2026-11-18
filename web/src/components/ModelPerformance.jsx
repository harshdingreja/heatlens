import AnomalyTimeline from './model/AnomalyTimeline'
import BacktestChart from './model/BacktestChart'
import ClusterChart from './model/ClusterChart'
import ConfusionMatrices from './model/ConfusionMatrices'
import HealthModels from './model/HealthModels'
import HeatwaveCases from './model/HeatwaveCases'
import KpiTiles from './model/KpiTiles'
import LeadMaeChart from './model/LeadMaeChart'
import ShapBars from './model/ShapBars'
import { LazyMount } from './model/shared'
import { Panel } from './Panel'

// Everything the ML does, measured on data the models never trained on.
// `report` is the /model response, fetched once by App.
export default function ModelPerformance({ report }) {
  const c = report.corrector
  return (
    <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
      <Panel id="kpis" title="Does the ML beat the weather model?" aside="2026 hold-out test, daily max heat index at Santacruz">
        <KpiTiles corrector={c} />
      </Panel>

      <Panel id="backtest" title="2026 backtest: forecast vs what happened">
        <LazyMount minHeight={380}>
          <BacktestChart corrector={c} />
        </LazyMount>
      </Panel>

      <Panel id="leads" title="Error by lead time: baselines vs ML" aside="Mean absolute error, °C (lower is better)">
        <LazyMount minHeight={520}>
          <LeadMaeChart corrector={c} />
        </LazyMount>
      </Panel>

      <Panel id="confusion" title="Alert levels: confusion matrices" aside="NOAA heat index levels, 2026 test">
        <ConfusionMatrices corrector={c} />
      </Panel>

      <Panel id="shap" title="What drives the correction (SHAP)" aside="Top 10 features">
        <ShapBars corrector={c} />
      </Panel>

      {report.heatwave_history && (
        <Panel id="heatwaves" title="Past heatwaves: real case studies" aside="Mumbai station data">
          <LazyMount minHeight={460}>
            <HeatwaveCases history={report.heatwave_history} />
          </LazyMount>
        </Panel>
      )}

      {report.anomalies && (
        <Panel id="anomalies" title="Anomaly detection: unusually hot for the date" aside="z-score vs IsolationForest">
          <LazyMount minHeight={460}>
            <AnomalyTimeline anomalies={report.anomalies} />
          </LazyMount>
        </Panel>
      )}

      {report.wards && (
        <Panel id="clusters" title="Ward vulnerability: clustering and validation">
          <LazyMount minHeight={420}>
            <ClusterChart wards={report.wards} />
          </LazyMount>
        </Panel>
      )}

      {report.health && (
        <Panel id="health" title="Health models" aside="Evidence-based estimates, not clinical predictions">
          <HealthModels health={report.health} />
        </Panel>
      )}
    </div>
  )
}
