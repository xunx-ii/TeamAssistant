import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const rootDir = resolve(import.meta.dirname, '..')
const clients = process.env.BENCH_CLIENTS ?? '30'
const port = process.env.BENCH_PORT ?? '23961'
const benchTimeoutMs = Number.parseInt(process.env.BENCH_TIMEOUT_MS ?? '30000', 10)
const tempDir = mkdtempSync(join(tmpdir(), 'teamassistant-bench-'))
const dbPath = join(tempDir, 'bench.sqlite3')

const backendCandidates = [
  resolve(rootDir, 'backend-cpp', 'build', 'teamassistant_backend.exe'),
  resolve(rootDir, 'backend-cpp', 'build', 'teamassistant_backend'),
  resolve(rootDir, 'backend-cpp', 'build', 'Debug', 'teamassistant_backend.exe'),
  resolve(rootDir, 'backend-cpp', 'build', 'Release', 'teamassistant_backend.exe'),
]

const benchCandidates = [
  resolve(rootDir, 'backend-cpp', 'build', 'teamassistant_concurrency_bench.exe'),
  resolve(rootDir, 'backend-cpp', 'build', 'teamassistant_concurrency_bench'),
  resolve(rootDir, 'backend-cpp', 'build', 'Debug', 'teamassistant_concurrency_bench.exe'),
  resolve(rootDir, 'backend-cpp', 'build', 'Release', 'teamassistant_concurrency_bench.exe'),
]

const backend = backendCandidates.find(candidate => existsSync(candidate))
const bench = benchCandidates.find(candidate => existsSync(candidate))

if (!backend || !bench) {
  console.error('未找到后端或压测程序，请先运行 npm run backend:configure && npm run backend:build')
  process.exit(1)
}

function spawnProcess(label, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', chunk => process.stdout.write(`[${label}] ${chunk}`))
  child.stderr.on('data', chunk => process.stderr.write(`[${label}] ${chunk}`))
  return child
}

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

async function waitForProcess(child, timeoutMs, label) {
  const exited = once(child, 'exit')
  const timeout = delay(timeoutMs).then(() => {
    throw new Error(`${label} 超时，已等待 ${timeoutMs}ms`)
  })
  return Promise.race([exited, timeout])
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

async function waitForBackend(child, url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (hasExited(child)) {
      throw new Error(`后端服务提前退出，退出码：${child.exitCode}`)
    }
    try {
      const response = await fetch(`${url}/api/v2/version`, { cache: 'no-store' })
      if (response.ok) return
    } catch {
      // keep waiting
    }
    await delay(250)
  }
  throw new Error('等待后端服务启动超时')
}

const url = `http://127.0.0.1:${port}`
const server = spawnProcess('server', backend, [], {
  PORT: port,
  TEAMASSISTANT_DB: dbPath,
})

let exitCode = 1
try {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await stopProcess(server)
      rmSync(tempDir, { recursive: true, force: true })
      process.exit(130)
    })
  }

  await waitForBackend(server, url)
  const scenarios = [
    { label: 'bench-diff', args: ['--url', url, '--clients', clients, '--sync-after-save'] },
    { label: 'bench-same', args: ['--url', url, '--clients', clients, '--same-slot'] },
  ]
  exitCode = 0
  for (const scenario of scenarios) {
    const runner = spawnProcess(scenario.label, bench, scenario.args)
    try {
      const [code] = await waitForProcess(runner, benchTimeoutMs, '并发压测')
      if ((code ?? 0) !== 0) {
        exitCode = code ?? 1
        break
      }
    } finally {
      await stopProcess(runner)
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
} finally {
  await stopProcess(server)
  rmSync(tempDir, { recursive: true, force: true })
}

process.exit(exitCode)
