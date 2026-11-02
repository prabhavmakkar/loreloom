import { describe, expect, it } from 'vitest'
import { makeApp } from './helpers.ts'

const X = { 'X-Loreloom': '1' }

describe('localGuard (review focus #3: CSRF / DNS rebinding)', () => {
  it('rejects /api requests without X-Loreloom', async () => {
    const { app } = await makeApp()
    expect((await app.request('/api/book')).status).toBe(403)
    expect((await app.request('/api/book', { method: 'POST', body: '{"sample":true}' })).status).toBe(403)
    expect((await app.request('/api/book', { headers: { 'X-Loreloom': '0' } })).status).toBe(403)
  })

  it('rejects a foreign Host (DNS rebinding), with or without the header', async () => {
    const { app } = await makeApp()
    expect((await app.request('/api/book', { headers: { ...X, Host: 'evil.com' } })).status).toBe(403)
    expect((await app.request('/api/book', { headers: { ...X, Host: 'evil.com:4317' } })).status).toBe(403)
    expect((await app.request('/api/book', { headers: { ...X, Host: '127.0.0.1.evil.com' } })).status).toBe(403)
    expect((await app.request('/', { headers: { Host: 'evil.com' } })).status).toBe(403)
    expect((await app.request('/api/events', { headers: { Host: 'rebind.example' } })).status).toBe(403)
  })

  it('rejects a foreign or opaque Origin even for a POST', async () => {
    const { app } = await makeApp()
    const post = (origin: string) =>
      app.request('/api/book', {
        method: 'POST',
        headers: { ...X, Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sample: true }),
      })
    expect((await post('https://evil.com')).status).toBe(403)
    expect((await post('null')).status).toBe(403)
    expect((await post('http://localhost.evil.com')).status).toBe(403)
    // and nothing was created by the rejected request
    const { app: a2, bookDir } = await makeApp()
    await a2.request('/api/book', { method: 'POST', headers: { ...X, Origin: 'https://evil.com' }, body: '{"sample":true}' })
    const { Book } = await import('@loreloom/core')
    expect(await Book.isBook(bookDir)).toBe(false)
  })

  it('rejects CORS preflights from other origins', async () => {
    const { app } = await makeApp()
    const res = await app.request('/api/book', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-loreloom' },
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('allows local hosts and origins with the header', async () => {
    const { app } = await makeApp()
    for (const host of ['localhost:5173', '127.0.0.1:4317', 'localhost']) {
      expect((await app.request('/api/book', { headers: { ...X, Host: host } })).status, host).toBe(200)
    }
    const res = await app.request('/api/book', { headers: { ...X, Host: '127.0.0.1:4317', Origin: 'http://localhost:5173' } })
    expect(res.status).toBe(200)
  })

  it('does not require the header for GET /api/events (but still checks Host)', async () => {
    const { app } = await makeApp()
    const ok = await app.request('/api/events', { headers: { Host: 'localhost:4317' } })
    expect(ok.status).not.toBe(403)
    // POST to /api/events is not exempt
    expect((await app.request('/api/events', { method: 'POST', headers: { Host: 'localhost:4317' } })).status).toBe(403)
  })

  it('does not require the header for non-API GETs', async () => {
    const { app } = await makeApp()
    expect((await app.request('/', { headers: { Host: 'localhost:4317' } })).status).not.toBe(403)
  })
})
