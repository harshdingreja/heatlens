// All calls to the HeatLens FastAPI backend live here.
// The base URL comes from the VITE_API_URL environment variable (set in .env or on Vercel).

export const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

// Mock mode is ONLY for working on the UI without a backend (npm run dev:mock).
// It is never switched on automatically: if the real API fails, the page shows an error.
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

// Sample files, loaded lazily so they never end up in the main bundle.
const mocks = {
  '/forecast': () => import('./mock/forecast.json'),
  '/wards': () => import('./mock/wards.json'),
  '/risk': () => import('./mock/risk.json'),
  '/advisory': () => import('./mock/advisory.json'),
  '/model': () => import('./mock/model.json'),
}

const TIMEOUT_MS = 75_000 // Render's free tier can take ~1 minute to wake up

async function request(path, options = {}) {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 400)) // pretend there's a network
    const key = path.split('?')[0]
    const mod = await mocks[key]()
    if (key === '/advisory') {
      const { lang } = JSON.parse(options.body)
      return mod.default[lang]
    }
    return mod.default
  }

  // AbortController lets us cancel the request if it takes too long.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(API_URL + path, { ...options, signal: controller.signal })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`The API answered ${res.status} for ${path}. ${detail.slice(0, 160)}`)
    }
    return await res.json()
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`The API at ${API_URL} did not answer within ${TIMEOUT_MS / 1000} seconds.`)
    }
    if (err instanceof TypeError) {
      // fetch throws TypeError when the server can't be reached at all (or CORS blocks it)
      throw new Error(`Can't reach the HeatLens API at ${API_URL}. Check that it is running.`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export const getForecast = (days = 5) => request(`/forecast?days=${days}`)
export const getWards = () => request('/wards')
export const getRisk = () => request('/risk')
export const getModel = () => request('/model') // ~185 KB: fetched once by App

export const postAdvisory = (lang) =>
  request('/advisory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang }),
  })
