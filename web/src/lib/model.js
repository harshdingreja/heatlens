// Human-readable names and small calculations for the /model report.
// Every number shown comes from the API; this file only names things and does arithmetic on them.

const FORECAST_MODELS = { icon_global: 'ICON', gfs_seamless: 'GFS', ecmwf_ifs025: 'ECMWF', jma_gsm: 'JMA' }
export const modelName = (id) => FORECAST_MODELS[id] ?? id

export const FINAL_METHOD = 'linear_plus_lightgbm'

// Order = how the methods are introduced: baselines first, then ML, then the final model.
export const METHODS = [
  { key: 'A_raw_forecast', label: 'Raw forecast', kind: 'baseline', color: '#8a9ba6', dash: '6 4' },
  { key: 'B_persistence', label: 'Persistence (yesterday)', kind: 'baseline', color: '#b49a6a', dash: '2 3' },
  { key: 'C_climatology', label: 'Climatology (normal)', kind: 'baseline', color: '#9fb0ba', dash: '1 3' },
  { key: 'D_multimodel_mean', label: '4-model mean', kind: 'baseline', color: '#6c7f8c', dash: '8 3 2 3' },
  { key: 'linear_regression', label: 'Linear regression', kind: 'ml', color: '#5b8db0' },
  { key: 'lightgbm', label: 'LightGBM', kind: 'ml', color: '#7a5ea8' },
  { key: FINAL_METHOD, label: 'HeatLens (linear + LightGBM)', kind: 'final', color: '#1d5e86' },
]
export const methodLabel = (key, rawModel) => {
  const m = METHODS.find((x) => x.key === key)
  if (!m) return key.replace(/_/g, ' ')
  return key === 'A_raw_forecast' && rawModel ? `Raw forecast (${modelName(rawModel)})` : m.label
}

// Feature names used by the corrector -> plain English
const SPECIAL_FEATURES = {
  recent_bias_7d: "Forecast's error over last 7 days",
  normal_hi: 'Climate normal for the date',
  ens_hi_mean: '4-model mean heat index',
  ens_hi_spread: 'Disagreement between the 4 models',
  doy_sin: 'Season (day of year, sine)',
  doy_cos: 'Season (day of year, cosine)',
  lead_days: 'Days ahead',
  obs_hi_last: 'Last observed heat index',
  obs_hi_mean_7d: 'Observed heat index, 7-day mean',
}
const VARIABLES = {
  rh_at_tmax: 'humidity at hottest hour',
  tmax: 'max temperature',
  hi_max: 'max heat index',
  sw_max: 'peak sunshine',
  wind_mean: 'mean wind',
  rh_mean: 'mean humidity',
  tmean: 'mean temperature',
}
export function featureLabel(name) {
  if (SPECIAL_FEATURES[name]) return SPECIAL_FEATURES[name]
  for (const id of Object.keys(FORECAST_MODELS)) {
    if (name.startsWith(id + '_')) {
      const v = name.slice(id.length + 1)
      return `${modelName(id)} ${VARIABLES[v] ?? v.replace(/_/g, ' ')}`
    }
  }
  return name.replace(/_/g, ' ')
}

// MCAP cross-check keys -> what was compared
const MCAP_LABELS = {
  our_lst_vs_mcap_lst: "Our satellite heat vs MCAP's heat ranking",
  our_hvi_vs_mcap_lst: "Our vulnerability index vs MCAP's heat ranking",
  our_hvi_rank_vs_mcap_roofing_rank: "Our vulnerability index vs MCAP's roofing ranking",
  our_slum_rank_vs_mcap_roofing_rank: "Our slum share vs MCAP's roofing ranking",
}
export const mcapLabel = (key) => MCAP_LABELS[key] ?? key.replace(/_/g, ' ')

const HEALTH_MODELS = {
  poisson_danger: 'Poisson: Danger days',
  poisson_danger_year: 'Poisson: Danger days + year',
  poisson_caution_year: 'Poisson: Caution days + year',
  negbin_danger_year: 'Negative binomial: Danger days + year',
}
export const healthModelLabel = (key) => HEALTH_MODELS[key] ?? key.replace(/_/g, ' ')

// NOAA levels used in the confusion matrices (same order as the API's labels)
const LEVELS = { green: 'Below caution', caution: 'Caution', extreme_caution: 'Ext. caution', danger: 'Danger', extreme_danger: 'Ext. danger' }
export const levelLabel = (key) => LEVELS[key] ?? key

// ---- small calculations ----
export const metric = (metrics, method, lead = 'all') =>
  metrics.find((m) => m.method === method && String(m.lead) === String(lead))

// Counts behind precision/recall: true positives, missed days, false alarms
export function alertCounts(alerts, method) {
  const a = alerts[method]
  const observed = alerts.observed_danger_days
  const hits = Math.round(a.recall * observed)
  return { ...a, hits, missed: observed - hits, falseAlarms: a.predicted_danger_days - hits }
}

export const fmt = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '–')
export const fmtP = (p) => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`)
export const pctOf = (v) => `${Math.round(v * 100)}%`
