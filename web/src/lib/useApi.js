import { useCallback, useEffect, useState } from 'react'

// Small hook: runs an async loader, remembers loading / error / data, and gives a reload().
// Each dashboard section uses its own copy, so one failing endpoint never blanks the whole page.
export function useApi(loader) {
  const [state, setState] = useState({ data: null, error: null, loading: true, slow: false })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null, slow: false }))
    // After 6 s we tell the user the free server is probably waking up.
    const slowTimer = setTimeout(() => !cancelled && setState((s) => ({ ...s, slow: true })), 6000)

    loader()
      .then((data) => !cancelled && setState({ data, error: null, loading: false, slow: false }))
      .catch((error) => !cancelled && setState({ data: null, error, loading: false, slow: false }))
      .finally(() => clearTimeout(slowTimer))

    return () => {
      cancelled = true
      clearTimeout(slowTimer)
    }
  }, [loader, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...state, reload }
}
