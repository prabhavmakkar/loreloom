import type { MiddlewareHandler } from 'hono'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

function hostnameOf(value: string, withScheme: boolean): string | null {
  try {
    return new URL(withScheme ? value : `http://${value}`).hostname
  } catch {
    return null
  }
}

function isLocal(hostname: string | null): boolean {
  return hostname !== null && LOCAL_HOSTS.has(hostname)
}

/**
 * Blocks DNS rebinding (Host check), cross-site requests (Origin check) and
 * CSRF (custom header that browsers can't send cross-origin without preflight).
 */
export function localGuard(): MiddlewareHandler {
  return async (c, next) => {
    const deny = () => c.json({ error: 'forbidden' }, 403)

    const host = c.req.header('host')
    const hostname = host !== undefined ? hostnameOf(host, false) : hostnameOf(c.req.url, true)
    if (!isLocal(hostname)) return deny()

    const origin = c.req.header('origin')
    if (origin !== undefined && !isLocal(hostnameOf(origin, true))) return deny()

    const path = c.req.path
    const isApi = path === '/api' || path.startsWith('/api/')
    const isEvents = c.req.method === 'GET' && path === '/api/events'
    if (isApi && !isEvents && c.req.header('x-loreloom') !== '1') return deny()

    await next()
  }
}
