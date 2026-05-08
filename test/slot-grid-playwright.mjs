import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PLAYWRIGHT_PORT ?? 5179)
const baseUrl = `http://127.0.0.1:${port}`

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
    id: 'team-e2e',
    name: '测试团',
    note: '',
    config: { reservedSlots: [1], locked: false },
    slots: createSlots(),
  }
}

async function waitForDevServer(process) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`Vite dev server exited early with code ${process.exitCode}`)
    }
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await delay(250)
  }
  throw new Error('Timed out waiting for Vite dev server')
}

async function assertCellContains(locator, expected) {
  const text = await locator.textContent()
  assert.match(text ?? '', expected)
}

const viteCli = resolve(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
const server = spawn(
  process.execPath,
  [viteCli, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  {
    cwd: rootDir,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)

let serverOutput = ''
server.stdout.on('data', chunk => { serverOutput += chunk.toString() })
server.stderr.on('data', chunk => { serverOutput += chunk.toString() })

let browser
try {
  await waitForDevServer(server)

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
  const ownColors = await ownCell.evaluate(element => {
    const style = getComputedStyle(element)
    return `${style.outlineColor} ${style.borderTopColor}`
  })
  assert.match(ownColors, /rgb\(255, 64, 64\)/)

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
} catch (error) {
  if (serverOutput.trim()) {
    console.error(serverOutput)
  }
  throw error
} finally {
  if (browser) await browser.close()
  server.kill()
}
