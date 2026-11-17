import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Vite = dev server + bundler. Two plugins:
// - react(): lets Vite understand JSX
// - tailwindcss(): turns the Tailwind classes we use into real CSS
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
