import { parsePhoneNumberFromString } from 'libphonenumber-js/max'

export function normalizePhone(raw: string): string {
  const input = raw.trim()
  const candidate = input.startsWith('60') ? `+${input}` : input
  const parsed = parsePhoneNumberFromString(candidate, { defaultCountry: 'MY', extract: false })
  if (!parsed?.isValid() || parsed.ext) throw new Error('Enter a valid phone number.')
  return parsed.number
}
export function validateRegistration(displayName: string, phone: string, password: string) {
  const name = displayName.trim()
  if (Array.from(name).length < 1 || Array.from(name).length > 80) throw new Error('Use 1–80 characters for your name or nickname.')
  if (password.length < 12) throw new Error('Use at least 12 characters for your password.')
  return { displayName: name, phone: normalizePhone(phone), password }
}
