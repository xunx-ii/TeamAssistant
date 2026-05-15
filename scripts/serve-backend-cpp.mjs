import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const rootDir = resolve(import.meta.dirname, '..')
const candidates = [
  resolve(rootDir, 'backend-cpp', 'build', 'teamassistant_backend.exe'),
  resolve(rootDir, 'backend-cpp', 'build', 'teamassistant_backend'),
  resolve(rootDir, 'backend-cpp', 'build', 'Release', 'teamassistant_backend.exe'),
]

const executable = candidates.find(candidate => existsSync(candidate))
if (!executable) {
  console.error('未找到 backend-cpp 构建产物，请先运行 npm run backend:configure && npm run backend:build')
  process.exit(1)
}

const child = spawn(executable, [], {
  cwd: rootDir,
  stdio: 'inherit',
  env: process.env,
})

child.on('exit', code => process.exit(code ?? 0))
