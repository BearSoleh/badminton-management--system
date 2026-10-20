import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { publicSupabaseConfig } from './public-config'

const config = publicSupabaseConfig(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)

export const supabase = config
  ? createClient<Database>(config.url, config.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  : null
