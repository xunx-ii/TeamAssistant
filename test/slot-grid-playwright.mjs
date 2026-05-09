import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { gzipSync } from 'node:zlib'
import { chromium } from 'playwright'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PLAYWRIGHT_PORT ?? 5179)
const baseUrl = `http://127.0.0.1:${port}`
const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 23229)
const apiBaseUrl = `http://127.0.0.1:${apiPort}`
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

function createEmptyTeam(name = '管理测试团', id = `team-admin-${runId}`) {
  return {
    id,
    name,
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

async function writeServerData(data) {
  const response = await fetch(`${apiBaseUrl}/api/data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-teamassistant-replace': '1',
    },
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
let importBackupPath = ''
let serverRoot = ''

async function prepareServerRoot() {
  const dir = resolve(rootDir, 'node_modules', '.tmp', `teamassistant-e2e-server-${runId}`)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  await cp(resolve(rootDir, 'server.js'), join(dir, 'server.js'))
  await cp(resolve(rootDir, 'server'), join(dir, 'server'), { recursive: true })
  return dir
}

let browser
try {
  serverRoot = await prepareServerRoot()
  apiServer = spawn(process.execPath, ['server.js'], {
    cwd: serverRoot,
    env: { ...process.env, BROWSER: 'none', PORT: String(apiPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  startedApiServer = true
  apiServer.stdout.on('data', chunk => { apiOutput += chunk.toString() })
  apiServer.stderr.on('data', chunk => { apiOutput += chunk.toString() })
  await waitForHttp(apiServer, `${apiBaseUrl}/api/data`, 'backend server')

  await writeServerData(createServerData(createTeam()))
  importBackupPath = resolve(tmpdir(), `teamassistant-import-${runId}.json.gz`)
  await writeFile(importBackupPath, gzipSync(Buffer.from(JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    data: createServerData(createEmptyTeam('导入备份团', `team-import-${runId}`)),
    locks: { slots: [], teams: [] },
  }))))

  viteServer = spawn(
    process.execPath,
    [viteCli, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: rootDir,
      env: { ...process.env, BROWSER: 'none', VITE_API_PROXY_TARGET: apiBaseUrl },
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

  await writeServerData({
    teams: [
      createEmptyTeam(),
      createEmptyTeam('切换测试团', `team-switch-${runId}`),
    ],
    cancellations: [],
    archivedTeams: [],
    logs: [],
  })

  const adminPage = await browser.newPage({ viewport: { width: 960, height: 900 } })
  await adminPage.addInitScript(team => {
    localStorage.setItem('team_qq', '89906502')
    localStorage.setItem('team_teams_v3', JSON.stringify([team]))
    localStorage.setItem('team_cancellations_v3', JSON.stringify([]))
    localStorage.setItem('team_archived_teams_v1', JSON.stringify([]))
    localStorage.setItem('team_operation_logs_v1', JSON.stringify([]))
  }, createEmptyTeam())

  await adminPage.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await adminPage.locator('.pixel-tab').filter({ hasText: '切换测试团' }).click()
  await waitForText(adminPage.locator('h2'), /切换测试团/, adminPage)
  await adminPage.locator('.pixel-tab').filter({ hasText: '管理测试团' }).click()
  await waitForText(adminPage.locator('h2'), /管理测试团/, adminPage)
  for (const opacity of await adminPage.locator('.pixel-tab').evaluateAll(elements => (
    elements.map(element => getComputedStyle(element).opacity)
  ))) {
    assert.equal(opacity, '1')
  }

  const backupButton = adminPage.getByRole('button', { name: '备份设置' })
  const presetButton = adminPage.getByRole('button', { name: '补贴预设' })
  const archiveButton = adminPage.getByRole('button', { name: '查看档案' })
  const subsidyRegisterButton = adminPage.getByRole('button', { name: '补贴登记' })
  const subsidyStatsButton = adminPage.getByRole('button', { name: '补贴统计' })
  const backupButtonBox = await backupButton.boundingBox()
  const presetButtonBox = await presetButton.boundingBox()
  const archiveButtonBox = await archiveButton.boundingBox()
  const subsidyRegisterButtonBox = await subsidyRegisterButton.boundingBox()
  const subsidyStatsButtonBox = await subsidyStatsButton.boundingBox()
  assert.ok(backupButtonBox && presetButtonBox && backupButtonBox.x < presetButtonBox.x)
  assert.ok(
    archiveButtonBox &&
    subsidyRegisterButtonBox &&
    subsidyStatsButtonBox &&
    archiveButtonBox.x < subsidyRegisterButtonBox.x &&
    subsidyRegisterButtonBox.x < subsidyStatsButtonBox.x,
  )

  await adminPage.getByRole('button', { name: '备份设置' }).click()
  const backupDialog = adminPage.locator('[role="dialog"]')
  await backupDialog.waitFor()
  await assertCellContains(backupDialog, /备份设置/)
  await assertCellContains(backupDialog, /历史备份列表/)
  await backupDialog.getByRole('button', { name: '立即备份' }).click()
  const backupNowConfirmDialog = adminPage.getByRole('dialog').filter({ hasText: '确定备份当前数据？' })
  await backupNowConfirmDialog.waitFor()
  await backupNowConfirmDialog.getByRole('button', { name: '备份' }).click()
  await waitForText(backupDialog, /已备份/, adminPage)
  await assertCellContains(backupDialog, /backup-/)
  await adminPage.getByRole('button', { name: 'Close' }).click()
  await backupDialog.waitFor({ state: 'detached' })

  await adminPage.getByRole('button', { name: '补贴预设' }).click()
  const presetDialog = adminPage.locator('[role="dialog"]')
  await presetDialog.waitFor()
  await assertCellContains(presetDialog, /补贴预设设置/)
  assert.equal(await presetDialog.locator('input').first().inputValue(), '伤害补贴')
  await adminPage.getByRole('button', { name: 'Close' }).click()
  await presetDialog.waitFor({ state: 'detached' })

  await adminPage.getByRole('button', { name: '创建团队' }).click()
  const createDialog = adminPage.getByRole('dialog').filter({ hasText: '创建团队' })
  await createDialog.waitFor()
  await createDialog.getByLabel('团队名称').fill('下周补贴团')
  await createDialog.getByRole('button', { name: '下周' }).click()
  await assertCellContains(createDialog, /\d{4}年\d+月\d+日-\d{4}年\d+月\d+日周/)
  await createDialog.getByRole('button', { name: '载入预设 ▾' }).click()
  await assertCellContains(createDialog, /伤害补贴/)
  await assertCellContains(createDialog, /第一:8000/)
  await createDialog.getByLabel(/伤害补贴/).check()
  await createDialog.getByRole('button', { name: '载入选中的预设' }).click()
  await assertCellContains(createDialog, /伤害补贴/)
  await createDialog.getByLabel('一键限坑').check()
  await createDialog.getByLabel(/^T$/).fill('2')
  await createDialog.getByLabel('奶').fill('2')
  await createDialog.getByLabel('老板').fill('1')
  await createDialog.getByRole('button', { name: '创建' }).click()
  await createDialog.waitFor({ state: 'detached' })
  await waitForText(adminPage.locator('h2'), /下周补贴团/, adminPage)
  await waitForText(adminPage.locator('[data-slot-index="20"]'), /T 位/, adminPage)
  await waitForText(adminPage.locator('[data-slot-index="15"]'), /奶 位/, adminPage)
  await waitForText(adminPage.locator('[data-slot-index="0"]'), /老板位/, adminPage)
  const createdTeam = await adminPage.evaluate(() => {
    const teams = JSON.parse(localStorage.getItem('team_teams_v3') ?? '[]')
    return teams.find(team => team.name === '下周补贴团')
  })
  assert.ok(createdTeam)
  assert.match(createdTeam.weekStart, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(createdTeam.subsidyTypes.length, 1)

  await adminPage.getByRole('button', { name: '补贴登记' }).click()
  const subsidyDialog = adminPage.getByRole('dialog').filter({ hasText: '补贴登记' })
  await subsidyDialog.waitFor()
  await assertCellContains(subsidyDialog, /下周补贴团/)
  await adminPage.getByRole('button', { name: 'Close' }).click()
  await subsidyDialog.waitFor({ state: 'detached' })

  await adminPage.getByRole('button', { name: '团队设置' }).click()
  await assertCellContains(adminPage.locator('body'), /团队时间/)
  await assertCellContains(adminPage.locator('body'), /\d{4}年\d+月\d+日-\d{4}年\d+月\d+日周/)
  await adminPage.getByRole('button', { name: '本周' }).click()
  await adminPage.waitForFunction(({ name, previousWeekStart }) => {
    const teams = JSON.parse(localStorage.getItem('team_teams_v3') ?? '[]')
    return teams.find(team => team.name === name)?.weekStart !== previousWeekStart
  }, { name: '下周补贴团', previousWeekStart: createdTeam.weekStart })
  const thisWeekTeam = await adminPage.evaluate(() => {
    const teams = JSON.parse(localStorage.getItem('team_teams_v3') ?? '[]')
    return teams.find(team => team.name === '下周补贴团')
  })
  assert.notEqual(thisWeekTeam.weekStart, createdTeam.weekStart)
  await adminPage.getByRole('button', { name: '自定义时间' }).click()
  await adminPage.getByLabel('自定义团队日期').fill('2026-05-17')
  await waitForText(adminPage.locator('body'), /2026年5月11日-2026年5月17日周/, adminPage)
  const customWeekTeam = await adminPage.evaluate(() => {
    const teams = JSON.parse(localStorage.getItem('team_teams_v3') ?? '[]')
    return teams.find(team => team.name === '下周补贴团')
  })
  assert.equal(customWeekTeam.weekStart, '2026-05-11')
  await adminPage.getByRole('button', { name: '收起设置' }).click()
  await adminPage.locator('.pixel-tab').filter({ hasText: '管理测试团' }).click()
  await waitForText(adminPage.locator('h2'), /管理测试团/, adminPage)

  await adminPage.getByRole('button', { name: '团队设置' }).click()

  const teamNameInput = adminPage.locator('input').first()
  await teamNameInput.fill('\uFFFC 表情团 🌸')
  assert.match(await teamNameInput.inputValue(), /表情团 🌸/)
  assert.doesNotMatch(await teamNameInput.inputValue(), /\uFFFC/)
  await delay(100)
  await teamNameInput.locator('xpath=..').getByRole('button', { name: '保存' }).click()
  await waitForText(adminPage.locator('h2'), /表情团 🌸/, adminPage)
  await assertCellContains(adminPage.locator('h2'), /^表情团 🌸$/)
  await adminPage.reload({ waitUntil: 'domcontentloaded' })
  await waitForText(adminPage.locator('h2'), /表情团 🌸/, adminPage)
  await assertCellContains(adminPage.locator('h2'), /^表情团 🌸$/)
  await adminPage.getByRole('button', { name: '团队设置' }).click()

  const activeTabAfterSwitch = adminPage.locator('.pixel-tab.active').first()
  await activeTabAfterSwitch.click()
  await delay(100)
  const activeTabOpacity = await activeTabAfterSwitch.evaluate(element => getComputedStyle(element).opacity)
  assert.equal(activeTabOpacity, '1')

  await adminPage.getByRole('button', { name: '备份设置' }).click()
  const restoreDialog = adminPage.locator('[role="dialog"]')
  await restoreDialog.waitFor()
  await restoreDialog.getByRole('button', { name: '回退' }).first().click()
  const backupConfirmDialog = adminPage.getByRole('dialog').filter({ hasText: '回退前是否先备份当前数据？' })
  await backupConfirmDialog.waitFor()
  await backupConfirmDialog.getByRole('button', { name: '先备份' }).click()
  const restoreConfirmDialog = adminPage.getByRole('dialog').filter({ hasText: '确定回退到该备份版本？' })
  await restoreConfirmDialog.waitFor()
  await restoreConfirmDialog.getByRole('button', { name: '回退' }).click()
  await waitForText(restoreDialog, /已备份并回退|已回退/, adminPage)
  await adminPage.getByRole('button', { name: 'Close' }).click()
  await restoreDialog.waitFor({ state: 'detached' })
  await waitForText(adminPage.locator('h2'), /管理测试团/, adminPage)

  await adminPage.getByRole('button', { name: '备份设置' }).click()
  const importDialog = adminPage.locator('[role="dialog"]')
  await importDialog.waitFor()
  await assertCellContains(importDialog, /删除/)
  const deletedBackupName = (await importDialog.locator('p').filter({ hasText: /backup-/ }).first().textContent())?.trim() ?? ''
  assert.match(deletedBackupName, /^backup-/)
  await importDialog.getByRole('button', { name: '删除' }).first().click()
  const deleteConfirmDialog = adminPage.getByRole('dialog').filter({ hasText: '确定删除该备份？' })
  await deleteConfirmDialog.waitFor()
  await deleteConfirmDialog.getByRole('button', { name: '删除' }).click()
  await waitForText(importDialog, /已删除/, adminPage)
  const backupNamesAfterDelete = await importDialog.locator('p').filter({ hasText: /backup-/ }).allTextContents()
  assert.equal(backupNamesAfterDelete.map(text => text.trim()).includes(deletedBackupName), false)
  const fileChooserPromise = adminPage.waitForEvent('filechooser')
  await importDialog.getByRole('button', { name: '导入备份文件' }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles(importBackupPath)
  const importBackupConfirmDialog = adminPage.getByRole('dialog').filter({ hasText: '导入前是否先备份当前数据？' })
  await importBackupConfirmDialog.waitFor()
  await importBackupConfirmDialog.getByRole('button', { name: '不备份' }).click()
  const importConfirmDialog = adminPage.getByRole('dialog').filter({ hasText: '确定导入并恢复该备份？' })
  await importConfirmDialog.waitFor()
  await importConfirmDialog.getByRole('button', { name: '导入并恢复' }).click()
  await waitForText(importDialog, /已导入/, adminPage)
  await adminPage.getByRole('button', { name: 'Close' }).click()
  await importDialog.waitFor({ state: 'detached' })
  await waitForText(adminPage.locator('h2'), /导入备份团/, adminPage)

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
  viteServer?.kill()
  if (startedApiServer) apiServer?.kill()
  if (importBackupPath) {
    await rm(importBackupPath, { force: true }).catch(() => {})
  }
  if (serverRoot) {
    await rm(serverRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
  }
}
