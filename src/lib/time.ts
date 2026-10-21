const klOffset = 8 * 60 * 60 * 1000
export function toKlInput(value: string): string {
  return new Date(new Date(value).getTime() + klOffset).toISOString().slice(0,16)
}
export function klInputToIso(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    const date = new Date(`${value}+08:00`)
    if (Number.isFinite(date.getTime()) && toKlInput(date.toISOString()) === value) return date.toISOString()
  }
  throw new Error('Use a valid Kuala Lumpur date and time.')
}
export function formatKlTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(value))
}
