import { describe, expect, it } from 'vitest'
import { normalizePhone, validateRegistration } from '../../src/features/auth/phone'

describe('phone identities', () => {
  it.each(['012-345 6789', '+60 12 345 6789', '60123456789', '+600123456789'])('canonicalizes Malaysian alias %s', (raw) => {
    expect(normalizePhone(raw)).toBe('+60123456789')
  })
  it('accepts a valid explicit international number', () => {
    expect(normalizePhone('+44 7911 123456')).toBe('+447911123456')
  })
  it.each(['', '123', 'hello 0123456789', '0123456789 ext 5'])('rejects invalid or ambiguous identity %s', (raw) => {
    expect(() => normalizePhone(raw)).toThrow('Enter a valid phone number.')
  })
})

describe('registration boundary', () => {
  it('accepts a nickname and preserves password bytes', () => {
    expect(validateRegistration('  Bear  ', '0123456789', '  a long password  ')).toEqual({
      displayName: 'Bear', phone: '+60123456789', password: '  a long password  ',
    })
  })
  it.each(['', '   ', 'x'.repeat(81)])('rejects an invalid display name', (name) => {
    expect(() => validateRegistration(name, '0123456789', 'long-enough-password')).toThrow('Use 1–80 characters for your name or nickname.')
  })
  it('requires at least 12 password characters', () => {
    expect(() => validateRegistration('Bear', '0123456789', 'short')).toThrow('Use at least 12 characters for your password.')
  })
})
