import { supabase } from '../../lib/supabase'
import type { Database } from '../../types/database'

export type Membership = Database['public']['Functions']['get_my_membership']['Returns'][number]
export class SessionExpiredError extends Error {}

export async function getMyMembership(): Promise<Membership> {
  if (!supabase) throw new Error('Club connection is not configured.')
  const { data, error, status } = await supabase.rpc('get_my_membership')
  if (status === 401) throw new SessionExpiredError('Your session has ended. Please log in again.')
  if (error || !data?.[0]) throw new Error('We couldn’t load your account. Please try again.')
  return data[0]
}

export async function register(displayName: string, rawPhone: string, password: string) {
  if (!supabase) throw new Error('Club connection is not configured.')
  const { validateRegistration } = await import('./phone')
  const values = validateRegistration(displayName, rawPhone, password)
  const { data, error } = await supabase.auth.signUp({
    phone: values.phone, password: values.password, options: { data: { display_name: values.displayName } },
  })
  if (error || !data.session) throw new Error('Unable to create an account. Check your details or contact a club admin if you already registered.')
}

export async function login(rawPhone: string, password: string) {
  if (!supabase) throw new Error('Club connection is not configured.')
  const { normalizePhone } = await import('./phone')
  const phone = normalizePhone(rawPhone)
  const { error } = await supabase.auth.signInWithPassword({ phone, password })
  if (error) throw new Error('Unable to log in. Check your phone number and password, then try again.')
}

export async function updateDisplayName(value: string) {
  const name = value.trim()
  if (Array.from(name).length < 1 || Array.from(name).length > 80) throw new Error('Use 1–80 characters for your name or nickname.')
  if (!supabase) throw new Error('Club connection is not configured.')
  const { error } = await supabase.rpc('update_my_display_name', { display_name_input: name })
  if (error) throw new Error('Unable to save your name. Refresh your account and try again.')
}
