import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PLAYWRIGHT_PORT ?? 5179)
const baseUrl = `http://127.0.0.1:${port}`
const apiBaseUrl = 'http://127.0.0.1:23219'
const runId = `e2e-${Date.now()}`

function createSlots() {
  const slots = Array.from({ length: 25 }, (_, index) => ({
    index,
    status: 'empty',
    member: null,
    fixedRole: null,
    fixedMartialArtIndex: null,
  }))

  slots[0] = {
    ...slots[0],
    status: 'occupied',
    member: {
      qq: '10001',
      martialArtIndex: '0',
      gearScore: '1200',
      characterId: '我的角色',
      note: '',
    },
  }
  slots[1] = {
    ...slots[1],
    status: 'reserved',
  }
  slots[2] = {
    ...slots[2],
    status: 'fixed',
    fixedRole: 'T',
  }

  return slots
}

function createTeam() {
  return {
    id: `team-${runId}`,
    name: '测试团',
    note: '',
    config: { reservedSlots: [1], locked: false },
    slots: createSlots(),
  }
}

function createEmptyTeam() {
  return {
    id: `team-admin-${runId}`,
    name: '管理测试团',
    note: '',
    config: { reservedSlots: [], locked: false },
    slots: Array.from({ length: 25 }, (_, index) => ({
      index,
      status: 'empty',
      member: null,
      fixedRole: null,
      fixedMartialArtIndex: null,
    })),
  }
}

function createServerData(team) {
  return {
    teams: [team],
    cancellations: [],
    archivedTeams: [],
    logs: [],
  }
}

function toPersistentData(data) {
  return {
    teams: Array.isArray(data?.teams) ? data.teams : [],
    cancellations: Array.isArray(data?.cancellations) ? data.cancellations : [],
    archivedTeams: Array.isArray(data?.archivedTeams) ? data.archivedTeams : [],
    logs: Array.isArray(data?.logs) ? data.logs : [],
  }
}

async function isApiReady() {
  try {
    const response = await fetch(`${apiBaseUrl}/api/data`, { cache: 'no-store' })
    return response.ok
  } catch {
    return false
  }
}

async function readServerData() {
  const response = await fetch(`${apiBaseUrl}/api/data`, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Failed to read server data: ${response.status}`)
  }
  return toPersistentData(await response.json())
}

async function writeServerData(data) {
  const response = await fetch(`${apiBaseUrl}/api/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toPersistentData(data)),
  })
  if (!response.ok) {
    throw new Error(`Failed to write server data: ${response.status}`)
  }
  const payload = await response.json().catch(() => null)
  if (payload?.ok === false) {
    throw new Error(`Failed to write server data: ${payload.error ?? 'unknown error'}`)
  }
}

async function waitForHttp(process, url, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`${label} exited early with code ${process.exitCode}`)
    }
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (response.ok) return
    } catch {
      // The process is still starting.
    }
    await delay(250)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function assertCellContains(locator, expected) {
  const text = await locator.textContent()
  assert.match(text ?? '', expected)
}

async function waitForText(locator, expected, page) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const text = await locator.textContent().catch(() => '')
    if (expected.test(text ?? '')) return
    await delay(100)
  }
  const text = await locator.textContent().catch(() => '')
  const storage = page ? await page.evaluate(() => localStorage.getItem('team_teams_v3')).catch(() => '') : ''
  assert.fail(`Timed out waiting for ${expected}. Current text: ${text ?? ''}. Storage: ${storage}`)
}

const viteCli = resolve(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
let apiServer = null
let startedApiServer = false
let viteServer = null
let apiOutput = ''
let viteOutput = ''
let originalServerData = null

let browser
try {
  if (!await isApiReady()) {
    apiServer = spawn(process.execPath, ['server.js'], {
      cwd: rootDir,
      env: { ...process.env, BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    startedApiServer = true
    apiServer.stdout.on('data', chunk => { apiOutput += chunk.toString() })
    apiServer.stderr.on('data', chunk => { apiOutput += chunk.toString() })
    await waitForHttp(apiServer, `${apiBaseUrl}/api/data`, 'backend server')
  }

  originalServerData = await readServerData()
  await writeServerData(createServerData(createTeam()))

  viteServer = spawn(
    process.execPath,
    [viteCli, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: rootDir,
      env: { ...process.env, BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  viteServer.stdout.on('data', chunk => { viteOutput += chunk.toString() })
  viteServer.stderr.on('data', chunk => { viteOutput += chunk.toString() })
  await waitForHttp(viteServer, baseUrl, 'Vite dev server')

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 960, height: 900 } })
  await page.addInitScript(team => {
    localStorage.setItem('team_qq', '10001')
    localStorage.setItem('team_teams_v3', JSON.stringify([team]))
    localStorage.setItem('team_cancellations_v3', JSON.stringify([]))
    localStorage.setItem('team_archived_teams_v1', JSON.stringify([]))
    localStorage.setItem('team_operation_logs_v1', JSON.stringify([]))
  }, createTeam())

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })

  const ownCell = page.locator('[data-slot-index="0"]')
  await ownCell.waitFor()
  assert.match(await ownCell.getAttribute('class') ?? '', /pixel-slot-owned/)
  const ownStyle = await ownCell.evaluate(element => {
    const style = getComputedStyle(element)
    return {
      borderTopColor: style.borderTopColor,
      outlineStyle: style.outlineStyle,
    }
  })
  assert.equal(ownStyle.borderTopColor, 'rgb(255, 105, 180)')
  assert.equal(ownStyle.outlineStyle, 'none')

  const reservedCell = page.locator('[data-slot-index="1"]')
  await assertCellContains(reservedCell, /老板位/)
  await assertCellContains(reservedCell, /可选/)

  const fixedCell = page.locator('[data-slot-index="2"]')
  await assertCellContains(fixedCell, /T 位/)
  await assertCellContains(fixedCell, /可选/)

  await fixedCell.click()
  const fixedDialog = page.locator('[role="dialog"]')
  await fixedDialog.waitFor()
  await assertCellContains(fixedDialog, /报名/)
  await assertCellContains(fixedDialog, /限定：T/)
  await page.getByRole('button', { name: 'Close' }).click()
  await fixedDialog.waitFor({ state: 'detached' })

  await reservedCell.click()
  const reservedDialog = page.locator('[role="dialog"]')
  await reservedDialog.waitFor()
  await assertCellContains(reservedDialog, /报名/)
  await assertCellContains(reservedDialog, /此位置为老板位/)
  await page.close()

  await writeServerData(createServerData(createEmptyTeam()))

  const adminPage = await browser.newPage({ viewport: { width: 960, height: 900 } })
  await adminPage.addInitScript(team => {
    localStorage.setItem('team_qq', '89906502')
    localStorage.setItem('team_teams_v3', JSON.stringify([team]))
    localStorage.setItem('team_cancellations_v3', JSON.stringify([]))
    localStorage.setItem('team_archived_teams_v1', JSON.stringify([]))
    localStorage.setItem('team_operation_logs_v1', JSON.stringify([]))
  }, createEmptyTeam())

  await adminPage.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await adminPage.getByRole('button', { name: '补贴预设设置' }).click()
  const presetDialog = adminPage.locator('[role="dialog"]')
  await presetDialog.waitFor()
  await assertCellContains(presetDialog, /补贴预设设置/)
  assert.equal(await presetDialog.locator('input').first().inputValue(), '伤害补贴')
  await adminPage.getByRole('button', { name: 'Close' }).click()
  await presetDialog.waitFor({ state: 'detached' })

  await adminPage.getByRole('button', { name: '团队设置' }).click()

  const teamNameInput = adminPage.locator('input').first()
  await teamNameInput.fill('\uFFFC 表情团 🌸')
  assert.match(await teamNameInput.inputValue(), /表情团 🌸/)
  await delay(100)
  await teamNameInput.locator('xpath=..').getByRole('button', { name: '保存' }).click()
  await waitForText(adminPage.locator('h2'), /表情团 🌸/, adminPage)
  await assertCellContains(adminPage.locator('h2'), /\uFFFC 表情团 🌸/)
  await adminPage.reload({ waitUntil: 'domcontentloaded' })
  await waitForText(adminPage.locator('h2'), /表情团 🌸/, adminPage)
  await assertCellContains(adminPage.locator('h2'), /\uFFFC 表情团 🌸/)
  await adminPage.getByRole('button', { name: '团队设置' }).click()

  const reserveInputs = adminPage.locator('input[type="number"]')
  const reserveButtons = adminPage.getByRole('button', { name: '预留' })

  await reserveInputs.nth(0).fill('2')
  await reserveButtons.nth(0).click()
  await waitForText(adminPage.locator('[data-slot-index="20"]'), /T 位/, adminPage)
  await waitForText(adminPage.locator('[data-slot-index="21"]'), /T 位/, adminPage)

  await reserveInputs.nth(1).fill('2')
  await reserveButtons.nth(1).click()
  await waitForText(adminPage.locator('[data-slot-index="15"]'), /奶 位/, adminPage)
  await waitForText(adminPage.locator('[data-slot-index="16"]'), /奶 位/, adminPage)
} catch (error) {
  const output = [apiOutput, viteOutput].filter(text => text.trim()).join('\n')
  if (output.trim()) {
    console.error(output)
  }
  throw error
} finally {
  if (browser) await browser.close()
  if (originalServerData) {
    await writeServerData(originalServerData).catch(error => {
      console.error(`Failed to restore server data: ${error instanceof Error ? error.message : error}`)
    })
  }
  viteServer?.kill()
  if (startedApiServer) apiServer?.kill()
}
