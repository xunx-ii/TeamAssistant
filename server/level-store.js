import { Level } from 'level'
import { existsSync, readFileSync } from 'fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { promisify } from 'util'
import { gzip, gunzip } from 'zlib'

const DATA_KEY = 'app:data'
const LOCKS_KEY = 'app:locks'
const ENCODING_MARKER = '__teamAssistantEncoding'
const BASE64_UTF8 = 'base64:utf8'
const BASE64_UTF16LE = 'base64:utf16le'
const BASE64_BINARY = 'base64:binary'
const BACKUP_PREFIX = 'backup-'
const BACKUP_SUFFIX = '.json.gz'
const LEGACY_BACKUP_SUFFIX = '.json'
const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

function isNotFoundError(error) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (
      error.code === 'LEVEL_NOT_FOUND' ||
      error.notFound === true ||
      error.status === 404
    ),
  )
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true
      index += 1
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return true
    }
  }
  return false
}

function shouldBase64EncodeString(value) {
  return (
    value.includes('\uFFFC') ||
    /^data:[^,]+;base64,/i.test(value) ||
    hasUnpairedSurrogate(value)
  )
}

function createEncodedValue(encoding, value) {
  return {
    [ENCODING_MARKER]: encoding,
    value,
  }
}

function isEncodedValue(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value[ENCODING_MARKER] === 'string' &&
    typeof value.value === 'string',
  )
}

export function encodeForLevelValue(value) {
  if (typeof value === 'string') {
    return shouldBase64EncodeString(value)
      ? createEncodedValue(BASE64_UTF16LE, Buffer.from(value, 'utf16le').toString('base64'))
      : value
  }

  if (Buffer.isBuffer(value)) {
    return createEncodedValue(BASE64_BINARY, value.toString('base64'))
  }

  if (ArrayBuffer.isView(value)) {
    const view = value
    return createEncodedValue(BASE64_BINARY, Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('base64'))
  }

  if (value instanceof ArrayBuffer) {
    return createEncodedValue(BASE64_BINARY, Buffer.from(value).toString('base64'))
  }

  if (Array.isArray(value)) {
    return value.map(item => encodeForLevelValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, encodeForLevelValue(item)]),
    )
  }

  return value
}

export function decodeFromLevelValue(value) {
  if (isEncodedValue(value)) {
    if (value[ENCODING_MARKER] === BASE64_UTF8) {
      return Buffer.from(value.value, 'base64').toString('utf8')
    }
    if (value[ENCODING_MARKER] === BASE64_UTF16LE) {
      return Buffer.from(value.value, 'base64').toString('utf16le')
    }
    if (value[ENCODING_MARKER] === BASE64_BINARY) {
      return Buffer.from(value.value, 'base64')
    }
  }

  if (Array.isArray(value)) {
    return value.map(item => decodeFromLevelValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, decodeFromLevelValue(item)]),
    )
  }

  return value
}

function readLegacyJson(filePath, normalize) {
  if (filePath && existsSync(filePath)) {
    try {
      return {
        found: true,
        value: normalize(JSON.parse(readFileSync(filePath, 'utf-8'))),
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to import legacy JSON ${basename(filePath)}: ${reason}`)
    }
  }
  return { found: false, value: null }
}

function backupFileName(now) {
  return `${BACKUP_PREFIX}${now.toISOString().replace(/[:.]/g, '-')}${BACKUP_SUFFIX}`
}

function backupCreatedAtFromName(name) {
  const suffix = name.endsWith(BACKUP_SUFFIX) ? BACKUP_SUFFIX : LEGACY_BACKUP_SUFFIX
  const value = name.slice(BACKUP_PREFIX.length, -suffix.length)
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/)
  if (!match) return null
  const [, year, month, day, hour, minute, second, ms] = match
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}Z`
}

async function writeCompressedJsonFileAtomic(filePath, value) {
  const tmpFile = `${filePath}.tmp`
  const content = Buffer.from(JSON.stringify(value), 'utf8')
  await writeFile(tmpFile, await gzipAsync(content))
  await rename(tmpFile, filePath)
}

function isBackupFileName(name) {
  return name.startsWith(BACKUP_PREFIX) && (
    name.endsWith(BACKUP_SUFFIX) ||
    name.endsWith(LEGACY_BACKUP_SUFFIX)
  )
}

function assertSafeBackupName(name) {
  if (basename(name) !== name || !isBackupFileName(name)) {
    throw new Error('Invalid backup name')
  }
}

function isGzipBuffer(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b
}

async function parseBackupBuffer(buffer) {
  const content = isGzipBuffer(buffer) ? await gunzipAsync(buffer) : buffer
  return JSON.parse(content.toString('utf8'))
}

export function createLevelStore({
  dbPath,
  legacyDataFile,
  legacyLocksFile,
  backupDir,
  maxBackups = 48,
  normalizeData,
  normalizeLocks,
}) {
  const db = new Level(dbPath, { valueEncoding: 'json' })

  async function getDecoded(key, normalize, fallback) {
    try {
      const value = await db.get(key)
      return value === undefined ? fallback : normalize(decodeFromLevelValue(value))
    } catch (error) {
      if (isNotFoundError(error)) return fallback
      throw error
    }
  }

  async function putEncoded(key, value) {
    await db.put(key, encodeForLevelValue(value))
  }

  function isFallbackValue(value, fallback) {
    return JSON.stringify(value) === JSON.stringify(fallback)
  }

  async function migrateLegacy(key, filePath, normalize, fallback) {
    let current
    let hasCurrent = false
    try {
      current = await db.get(key)
      hasCurrent = current !== undefined
    } catch (error) {
      if (!isNotFoundError(error)) throw error
    }

    const currentValue = hasCurrent ? normalize(decodeFromLevelValue(current)) : fallback
    if (hasCurrent && !isFallbackValue(currentValue, fallback)) {
      return
    }

    const legacy = readLegacyJson(filePath, normalize)
    if (legacy.found) {
      await putEncoded(key, legacy.value)
      return
    }

    if (!hasCurrent) {
      await putEncoded(key, fallback)
    }
  }

  async function pruneBackups() {
    if (!backupDir || maxBackups <= 0) return
    const entries = await readdir(backupDir).catch(error => {
      if (error && typeof error === 'object' && error.code === 'ENOENT') return []
      throw error
    })
    const backups = entries
      .filter(isBackupFileName)
      .sort()
      .reverse()
    const stale = backups.slice(maxBackups)
    await Promise.all(stale.map(name => rm(join(backupDir, name), { force: true })))
  }

  function normalizeBackupPayload(payload) {
    const source = payload && typeof payload === 'object' && 'data' in payload
      ? payload
      : { data: payload, locks: {} }
    const data = normalizeData(source.data)
    if (data.teams.length === 0) {
      throw new Error('Invalid backup data')
    }
    return {
      version: Number.isInteger(source.version) ? source.version : 1,
      createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString(),
      data,
      locks: normalizeLocks(source.locks),
    }
  }

  async function readBackupPayload(name) {
    if (!backupDir) throw new Error('Backup directory is not configured')
    assertSafeBackupName(name)
    return normalizeBackupPayload(await parseBackupBuffer(await readFile(join(backupDir, name))))
  }

  async function writeImportedBackup(payload, now) {
    if (!backupDir) return null
    await mkdir(backupDir, { recursive: true })
    const filePath = join(backupDir, backupFileName(now))
    await writeCompressedJsonFileAtomic(filePath, {
      ...payload,
      createdAt: now.toISOString(),
    })
    await pruneBackups()
    return basename(filePath)
  }

  async function restoreBackupPayload(payload) {
    await putEncoded(DATA_KEY, payload.data)
    await putEncoded(LOCKS_KEY, payload.locks)
    return {
      data: normalizeData(payload.data),
      locks: normalizeLocks(payload.locks),
    }
  }

  return {
    async init() {
      await db.open()
      await migrateLegacy(DATA_KEY, legacyDataFile, normalizeData, normalizeData({}))
      await migrateLegacy(LOCKS_KEY, legacyLocksFile, normalizeLocks, normalizeLocks({}))
    },

    async readData() {
      return getDecoded(DATA_KEY, normalizeData, normalizeData({}))
    },

    async writeData(data) {
      await putEncoded(DATA_KEY, normalizeData(data))
    },

    async readLocks() {
      return getDecoded(LOCKS_KEY, normalizeLocks, normalizeLocks({}))
    },

    async writeLocks(lockData) {
      await putEncoded(LOCKS_KEY, normalizeLocks(lockData))
    },

    async backupNow(now = new Date()) {
      if (!backupDir) return null
      await mkdir(backupDir, { recursive: true })
      const filePath = join(backupDir, backupFileName(now))
      await writeCompressedJsonFileAtomic(filePath, {
        version: 1,
        createdAt: now.toISOString(),
        data: await this.readData(),
        locks: await this.readLocks(),
      })
      await pruneBackups()
      return basename(filePath)
    },

    async listBackups() {
      if (!backupDir) return []
      const entries = await readdir(backupDir).catch(error => {
        if (error && typeof error === 'object' && error.code === 'ENOENT') return []
        throw error
      })
      const backups = await Promise.all(entries
        .filter(isBackupFileName)
        .map(async name => {
          const details = await stat(join(backupDir, name))
          return {
            name,
            createdAt: backupCreatedAtFromName(name) ?? details.mtime.toISOString(),
            size: details.size,
          }
        }))
      return backups.sort((left, right) => right.name.localeCompare(left.name))
    },

    async readBackup(name) {
      return readBackupPayload(name)
    },

    async restoreBackup(name) {
      const backup = await readBackupPayload(name)
      await this.backupNow()
      return restoreBackupPayload(backup)
    },

    async importBackup(buffer, now = new Date()) {
      const backup = normalizeBackupPayload(await parseBackupBuffer(buffer))
      await this.backupNow()
      const name = await writeImportedBackup(backup, now)
      const restored = await restoreBackupPayload(backup)
      return {
        name,
        ...restored,
      }
    },

    async close() {
      await db.close()
    },
  }
}
