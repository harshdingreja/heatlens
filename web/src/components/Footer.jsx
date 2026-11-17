const REPO_URL = import.meta.env.VITE_REPO_URL

const SOURCES = [
  ['Station observations', 'NOAA GHCNh via Meteostat: Santacruz (43003) and Colaba (43057)'],
  ['Weather history and forecasts', 'Open-Meteo: ERA5 reanalysis, Previous Runs archive, live Forecast API'],
  ['Satellite heat and greenery', 'Landsat Collection 2 surface temperature and NDVI via Microsoft Planetary Computer'],
  ['Ward population data', 'Census of India 2011; ward boundaries from DataMeet'],
  ['Heat and mortality', 'Environment International 184 (2024) 108461, multi-city study of heatwaves and deaths in India'],
]

export default function Footer() {
  return (
    <footer className="mt-10 border-t border-line pt-6 pb-10 text-sm text-ink-soft">
      <h2 className="font-bold text-ink">Data sources</h2>
      <dl className="mt-2 grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {SOURCES.map(([what, source]) => (
          <div key={what}>
            <dt className="font-semibold text-ink">{what}</dt>
            <dd>{source}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 max-w-[75ch]">
        HeatShield is a student project for Smart India Hackathon 2026 (problem statement SIH26083). Its estimates support planning;
        they are not official IMD warnings or medical advice.{' '}
        {REPO_URL ? (
          <a className="font-semibold text-sea underline" href={`${REPO_URL.replace(/\/$/, '')}#limitations`}>
            Read the limitations
          </a>
        ) : (
          'The limitations are listed in the project README.'
        )}
      </p>
    </footer>
  )
}
