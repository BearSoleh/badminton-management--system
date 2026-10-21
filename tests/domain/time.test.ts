import { describe, expect, it } from 'vitest'
import { formatKlTime, klInputToIso, toKlInput } from '../../src/lib/time'
describe('explicit Kuala Lumpur session time display/input', () => {
  it('converts a KL calendar input to UTC independently of device timezone', () => {
    expect(klInputToIso('2026-10-23T20:00')).toBe('2026-10-23T12:00:00.000Z')
    expect(toKlInput('2026-10-22T16:00:00Z')).toBe('2026-10-23T00:00')
  })
  it('rejects empty, malformed and nonexistent calendar inputs', () => {
    for (const raw of ['', '2026-02-31T20:00', 'not a date', '2026-10-23']) expect(() => klInputToIso(raw)).toThrow('Use a valid Kuala Lumpur date and time.')
  })
  it('displays the KL day and time in English', () => {
    const formatted = formatKlTime('2026-10-22T16:00:00Z')
    expect(formatted).toContain('23 Oct 2026')
    expect(formatted).toMatch(/12:00\s*am/i)
  })
})
