import test from 'node:test'
import assert from 'node:assert/strict'

function createJsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

function createStorage() {
  const values = new Map()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    clear: () => values.clear(),
  }
}

async function withBrowserMocks({ fetch }, run) {
  const originalFetch = globalThis.fetch
  const originalStorage = globalThis.localStorage
  globalThis.fetch = fetch
  globalThis.localStorage = createStorage()
  try {
    await run(globalThis.localStorage)
  } finally {
    globalThis.fetch = originalFetch
    if (originalStorage === undefined) {
      delete globalThis.localStorage
    } else {
      globalThis.localStorage = originalStorage
    }
  }
}

const oldPreset = {
  id: 'preset-old',
  name: '旧预设',
  levels: [{ name: '一', gold: 100 }],
}

const nextPreset = {
  id: 'preset-next',
  name: '新预设',
  levels: [{ name: '二', gold: 200 }],
}

test('saveSubsidyPresetsRemote keeps local presets unchanged when server save fails', async () => {
  await withBrowserMocks({
    fetch: async () => createJsonResponse({ ok: false }),
  }, async (storage) => {
    const mod = await import(`../src/subsidyPresets.ts?case=${Date.now()}-remote-fail`)

    mod.saveSubsidyPresets([oldPreset])
    const saved = await mod.saveSubsidyPresetsRemote([nextPreset])

    assert.equal(saved, false)
    assert.deepEqual(JSON.parse(storage.getItem('team_subsidy_presets_v1')), [oldPreset])
  })
})

test('saveSubsidyPresetsRemote writes local presets after server save succeeds', async () => {
  await withBrowserMocks({
    fetch: async () => createJsonResponse({ ok: true }),
  }, async (storage) => {
    const mod = await import(`../src/subsidyPresets.ts?case=${Date.now()}-remote-ok`)

    const saved = await mod.saveSubsidyPresetsRemote([nextPreset])

    assert.equal(saved, true)
    assert.deepEqual(JSON.parse(storage.getItem('team_subsidy_presets_v1')), [nextPreset])
  })
})
