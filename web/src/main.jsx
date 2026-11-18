import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css' // map styles (tiles, popups, zoom buttons)
import './index.css' // Tailwind + our design tokens
import App from './App.jsx'

// We handle scrolling to #links ourselves (see App.jsx), because sections grow as data arrives.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
