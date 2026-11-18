# HeatLens web dashboard

React 19 + Vite 8 + Tailwind CSS 4, with react-leaflet (ward map) and Recharts (forecast chart).
It reads everything from the HeatLens FastAPI backend (see `../docs/API_CONTRACT.md`).

## Run locally
```bash
cd web
npm install
cp .env.example .env        # VITE_API_URL=http://localhost:8000
npm run dev                 # http://localhost:5173 (start the API first)
```
`npm run dev:mock` shows built-in SAMPLE data with a yellow banner. It's for UI work only, never for demos.

## Build
```bash
npm run build               # output in web/dist
```

## Deploy on Vercel
New Project → import the GitHub repo → **Root Directory: `web`** (Vite is auto-detected).
Add the environment variable `VITE_API_URL` = your Render API URL (optionally `VITE_REPO_URL`), then Deploy.
`vercel.json` rewrites every path to `index.html`.
