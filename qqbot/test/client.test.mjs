import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createTeamClient, describeError, TeamApiError } from '../src/team.js'

let server, baseUrl

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/delayed-headers') return
    if (url.pathname === '/delayed-body') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.flushHeaders()
      return
    }
    if (url.pathname === '/html') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html>Service unavailable</html>')
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    if (url.pathname === '/null') res.end('null')
    else if (url.pathname === '/array') res.end('[]')
    else if (url.pathname === '/conflict') res.end(JSON.stringify({ ok: false, lockedBy: '20001' }))
    else res.end(JSON.stringify({ ok: true, query: Object.fromEntries(url.searchParams) }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  const closed = new Promise(resolve => server.close(resolve))
  server.closeAllConnections()
  await closed
})

test('request preserves existing parameters and encodes the invite token once', async () => {
  const inviteToken = '令牌?&#+='
  const client = createTeamClient({ baseUrl, inviteToken })
  const response = await client.request('GET', '/query?actorQq=10001&other=value')
  assert.deepEqual(response.query, { actorQq: '10001', other: 'value', inviteToken })
})

test('request times out while waiting for headers and while reading the body', async () => {
  const client = createTeamClient({ baseUrl, inviteToken: '', timeoutMs: 100 })
  for (const path of ['/delayed-headers', '/delayed-body']) {
    await assert.rejects(client.request('GET', path), error => (
      error instanceof TeamApiError && error.reason === 'timeout' && describeError(error).includes('超时')
    ))
  }
})

test('successful HTTP responses with invalid JSON payloads fail explicitly', async () => {
  const client = createTeamClient({ baseUrl, inviteToken: '' })
  for (const path of ['/html', '/null', '/array']) {
    await assert.rejects(client.request('GET', path), error => error instanceof TeamApiError && error.reason === 'invalidResponse')
  }
})

test('legacy HTTP 200 contention responses retain the lock owner', async () => {
  const client = createTeamClient({ baseUrl, inviteToken: '' })
  await assert.rejects(client.request('GET', '/conflict'), error => error.reason === 'lockedBy' && error.data.lockedBy === '20001')
})

test('invalid timeout configuration fails before issuing a request', () => {
  for (const timeoutMs of [0, -1, NaN, Infinity, 2_147_483_648]) {
    assert.throws(() => createTeamClient({ baseUrl, timeoutMs }), RangeError)
  }
})
