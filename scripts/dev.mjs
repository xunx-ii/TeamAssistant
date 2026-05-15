import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const rootDir = resolve(import.meta.dirname, '..')
const frontendDir = resolve(rootDir, 'frontend')
const apiUrl = 'http://127.0.0.1:23219/api/v2/version'
const viteHost = process.env.VITE_HOST ?? '0.0.0.0'
const vitePort = process.env.VITE_PORT ?? '5173'
const viteCli = resolve(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
const cppServerCandidates = [
  resolve(rootDir, 'backend-cpp', 'build', 'teamassistant_backend.exe'),
  resolve(rootDir, 'backend-cpp', 'build', 'teamassistant_backend'),
  resolve(rootDir, 'backend-cpp', 'build', 'Debug', 'teamassistant_backend.exe'),
  resolve(rootDir, 'backend-cpp', 'build', 'Release', 'teamassistant_backend.exe'),
]
const children = new Set()

function spawnProcess(label, command, args, cwd = rootDir) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  children.add(child)
  child.stdout.on('data', chunk => process.stdout.write(`[${label}] ${chunk}`))
  child.stderr.on('data', chunk => process.stderr.write(`[${label}] ${chunk}`))
  child.once('exit', () => children.delete(child))
  return child
}

async function isApiReady() {
  try {
    const response = await fetch(apiUrl, { cache: 'no-store' })
    if (!response.ok) return false
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('json')) return false
    const payload = await response.json()
    return Boolean(
      payload &&
      typeof payload === 'object' &&
      typeof payload.dataVersion === 'number' &&
      typeof payload.lockVersion === 'number',
    )
  } catch {
    return false
  }
}

async function waitForApi(serverProcess) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await isApiReady()) return
    if (serverProcess.exitCode !== null) {
      throw new Error(`后端服务提前退出，退出码：${serverProcess.exitCode}`)
    }
    await delay(250)
  }
  throw new Error('等待后端服务启动超时')
}

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

async function stopProcess(child) {
  if (!child || hasExited(child)) return
  const exited = once(child, 'exit')
  child.kill()
  await Promise.race([exited, delay(2_000)])
  if (!hasExited(child)) {
    child.kill('SIGKILL')
    await Promise.race([exited, delay(1_000)])
  }
}

async function stopChildren() {
  await Promise.all([...children].map(child => stopProcess(child)))
}

function exitAfterStop(code) {
  void stopChildren().finally(() => process.exit(code))
}

process.once('SIGINT', () => {
  exitAfterStop(130)
})

process.once('SIGTERM', () => {
  exitAfterStop(143)
})

let startedServer = false
let serverProcess = null

if (await isApiReady()) {
  process.stdout.write('[server] 使用已运行的 http://127.0.0.1:23219\n')
} else {
  const cppServer = cppServerCandidates.find(candidate => existsSync(candidate))
  if (cppServer) {
    serverProcess = spawnProcess('server', cppServer, [], rootDir)
  } else {
    process.stderr.write('[server] 未找到 backend-cpp 构建产物，请先运行 npm run backend:configure && npm run backend:build\n')
    process.exit(1)
  }
  startedServer = true
  await waitForApi(serverProcess)
}

const viteProcess = spawnProcess('vite', process.execPath, [
  viteCli,
  '--host',
  viteHost,
  '--port',
  vitePort,
  '--strictPort',
], frontendDir)

viteProcess.once('exit', code => {
  void (async () => {
    if (startedServer) await stopProcess(serverProcess)
    process.exit(code ?? 0)
  })()
})

serverProcess?.once('exit', code => {
  if (startedServer && viteProcess.exitCode === null) {
    void (async () => {
      await stopProcess(viteProcess)
      process.exit(code ?? 1)
    })()
  }
})
