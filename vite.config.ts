import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { publicSupabaseConfig } from './src/lib/public-config.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  if ((env.VITE_SUPABASE_URL || env.VITE_SUPABASE_PUBLISHABLE_KEY) && !publicSupabaseConfig(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
    // Fail before the bundler can embed a backend credential. Never echo values.
    throw new Error('Invalid public Supabase configuration. Use an HTTPS URL (or local HTTP) and a publishable/anon key, never a backend secret.')
  }
  return { plugins: [react(), tailwindcss()], server: { port: 5173, strictPort: true } }
})
