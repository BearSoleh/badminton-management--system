export function publicSupabaseConfig(url: string | undefined, key: string | undefined): { url: string; key: string } | null {
  const publicUrl = url?.trim()
  const publicKey = key?.trim()
  if (!publicUrl || !publicKey || publicKey.startsWith('sb_secret_')) return null
  try {
    const parsed = new URL(publicUrl)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) return null
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null
    if (!publicKey.startsWith('sb_publishable_')) {
      const payload = JSON.parse(atob(publicKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (payload.role !== 'anon') return null
    }
    return { url: publicUrl, key: publicKey }
  } catch { return null }
}
