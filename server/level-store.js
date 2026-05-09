import { Level } from 'level'
import { existsSync, readFileSync } from 'fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { promisify } from 'util'
import { gzip, gunzip } from 'zlib'

const DATA_KEY = 'app:data'
const LOCKS_KEY = 'app:locks'
const SUBSIDY_PRESETS_KEY = 'app:subsidy-presets'
const ENCODING_MARKER = '__teamAssistantEncoding'
const BASE64_UTF8 = 'base64:utf8'
const BASE64_UTF16LE = 'base64:utf16le'
const BASE64_BINARY = 'base64:binary'
const BACKUP_PREFIX = 'backup-'
const BACKUP_SUFFIX = '.json.gz'
const LEGACY_BACKUP_SUFFIX = '.json'
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

function pad2(value) {
  return String(value).padStart(2, '0')
}

function pad3(value) {
  return String(value).padStart(3, '0')
}

function toShanghaiDate(value) {
  return new Date(value.getTime() + SHANGHAI_OFFSET_MS)
}

function formatShanghaiBackupStamp(value) {
  const date = toShanghaiDate(value)
  return [
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`,
    `T${pad2(date.getUTCHours())}-${pad2(date.getUTCMinutes())}-${pad2(date.getUTCSeconds())}-${pad3(date.getUTCMilliseconds())}+08-00`,
  ].join('')
}

function formatShanghaiISOString(value) {
  const date = toShanghaiDate(value)
  return [
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`,
    `T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}.${pad3(date.getUTCMilliseconds())}+08:00`,
  ].join('')
}

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
  return `${BACKUP_PREFIX}${formatShanghaiBackupStamp(now)}${BACKUP_SUFFIX}`
}

async function createBackupTarget(backupDir, now) {
  for (let offset = 0; offset < 1000; offset += 1) {
    const createdAt = new Date(now.getTime() + offset)
    const name = backupFileName(createdAt)
    const filePath = join(backupDir, name)
    const exists = await stat(filePath)
      .then(() => true)
      .catch(error => {
        if (error && typeof error === 'object' && error.code === 'ENOENT') return false
        throw error
      })
    if (!exists) {
      return { createdAt, filePath, name }
    }
  }
  throw new Error('Unable to allocate backup file name')
}

function backupCreatedAtFromName(name) {
  const suffix = name.endsWith(BACKUP_SUFFIX) ? BACKUP_SUFFIX : LEGACY_BACKUP_SUFFIX
  const value = name.slice(BACKUP_PREFIX.length, -suffix.length)
  const offsetMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})([+-]\d{2})-(\d{2})$/)
  if (offsetMatch) {
    const [, year, month, day, hour, minute, second, ms, offsetHour, offsetMinute] = offsetMatch
    return `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}${offsetHour}:${offsetMinute}`
  }
  const utcMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/)
  if (!utcMatch) return null
  const [, year, month, day, hour, minute, second, ms] = utcMatch
  return formatShanghaiISOString(new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}Z`))
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
  normalizeBackupData = normalizeData,
  normalizeLocks,
  validateData = data => data.teams.length > 0,
  normalizeSubsidyPresets = value => Array.isArray(value) ? value : [],
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
    const backups = await Promise.all(entries
      .filter(isBackupFileName)
      .map(async name => {
        const details = await stat(join(backupDir, name))
        const createdAt = backupCreatedAtFromName(name) ?? formatShanghaiISOString(details.mtime)
        const timestamp = new Date(createdAt).getTime()
        return {
          name,
          timestamp: Number.isNaN(timestamp) ? details.mtimeMs : timestamp,
        }
      }))
    backups.sort((left, right) => right.timestamp - left.timestamp || right.name.localeCompare(left.name))
    const stale = backups.slice(maxBackups)
    await Promise.all(stale.map(backup => rm(join(backupDir, backup.name), { force: true })))
  }

  function normalizeBackupPayload(payload) {
    const source = payload && typeof payload === 'object' && 'data' in payload
      ? payload
      : { data: payload, locks: {} }
    const data = normalizeBackupData(source.data)
    if (!validateData(data)) {
      throw new Error('Invalid backup data')
    }
    return {
      version: Number.isInteger(source.version) ? source.version : 1,
      createdAt: typeof source.createdAt === 'string' ? source.createdAt : formatShanghaiISOString(new Date()),
      data,
      locks: normalizeLocks(source.locks),
      subsidyPresets: normalizeSubsidyPresets(source.subsidyPresets),
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
    const target = await createBackupTarget(backupDir, now)
    await writeCompressedJsonFileAtomic(target.filePath, {
      ...payload,
      createdAt: formatShanghaiISOString(target.createdAt),
    })
    await pruneBackups()
    return target.name
  }

  async function restoreBackupPayload(payload) {
    await putEncoded(DATA_KEY, payload.data)
    await putEncoded(LOCKS_KEY, payload.locks)
    await putEncoded(SUBSIDY_PRESETS_KEY, payload.subsidyPresets)
    return {
      data: normalizeData(payload.data),
      locks: normalizeLocks(payload.locks),
      subsidyPresets: normalizeSubsidyPresets(payload.subsidyPresets),
    }
  }

  return {
    async init() {
      await db.open()
      await migrateLegacy(DATA_KEY, legacyDataFile, normalizeData, normalizeData({}))
      await migrateLegacy(LOCKS_KEY, legacyLocksFile, normalizeLocks, normalizeLocks({}))
      await migrateLegacy(SUBSIDY_PRESETS_KEY, null, normalizeSubsidyPresets, normalizeSubsidyPresets([]))
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
      const target = await createBackupTarget(backupDir, now)
      await writeCompressedJsonFileAtomic(target.filePath, {
        version: 1,
        createdAt: formatShanghaiISOString(target.createdAt),
        data: await this.readData(),
        locks: await this.readLocks(),
        subsidyPresets: await this.readSubsidyPresets(),
      })
      await pruneBackups()
      return target.name
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
          const createdAt = backupCreatedAtFromName(name) ?? formatShanghaiISOString(details.mtime)
          const timestamp = new Date(createdAt).getTime()
          return {
            name,
            createdAt,
            timestamp: Number.isNaN(timestamp) ? details.mtimeMs : timestamp,
            size: details.size,
          }
        }))
      return backups
        .sort((left, right) => right.timestamp - left.timestamp || right.name.localeCompare(left.name))
        .map(({ timestamp, ...backup }) => backup)
    },

    async readBackup(name) {
      return readBackupPayload(name)
    },

    async restoreBackup(name) {
      const backup = await readBackupPayload(name)
      return restoreBackupPayload(backup)
    },

    async deleteBackup(name) {
      if (!backupDir) throw new Error('Backup directory is not configured')
      assertSafeBackupName(name)
      await rm(join(backupDir, name))
    },

    async importBackup(buffer, now = new Date()) {
      const backup = normalizeBackupPayload(await parseBackupBuffer(buffer))
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

    async readSubsidyPresets() {
      return getDecoded(SUBSIDY_PRESETS_KEY, normalizeSubsidyPresets, normalizeSubsidyPresets([]))
    },

    async writeSubsidyPresets(presets) {
      await putEncoded(SUBSIDY_PRESETS_KEY, normalizeSubsidyPresets(presets))
    },
  }
}
