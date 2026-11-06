import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../qqbot/src/config.js'

try {
  const configPath = process.env.TEAMASSISTANT_ADMIN_CONFIG
  if (!configPath) throw new Error('缺少 TEAMASSISTANT_ADMIN_CONFIG')

  let admin = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {}
  if (!admin || typeof admin !== 'object' || Array.isArray(admin)) {
    throw new Error('管理员配置必须是 JSON 对象')
  }

  const configuredQqs = process.env.TEAMASSISTANT_ADMIN_QQS?.trim()
  if (configuredQqs) {
    admin = { ...admin, adminQQs: [...new Set(configuredQqs.split(',').map(qq => qq.trim()))] }
  }
  const qqs = admin.adminQQs ?? admin.admins
  if (!Array.isArray(qqs) || !qqs.length || !qqs.every(qq => typeof qq === 'string' && /^[1-9]\d{4,19}$/.test(qq))) {
    throw new Error('请通过 TEAMASSISTANT_ADMIN_QQS 配置管理员 QQ，多人使用英文逗号分隔，或挂载有效的 admin.json')
  }

  const password = process.env.TEAMASSISTANT_ADMIN_PASSWORD || admin.adminPassword
  const hash = process.env.TEAMASSISTANT_ADMIN_PASSWORD_HASH || admin.adminPasswordHash
  if (!(typeof password === 'string' && password.length > 0) && !hash) {
    throw new Error('请设置 TEAMASSISTANT_ADMIN_PASSWORD 或管理员密码哈希')
  }
  if (hash && !/^[a-f\d]{64}$/i.test(hash)) throw new Error('管理员密码哈希必须是 64 位十六进制 SHA-256')

  if (process.env.QQBOT_ENABLED === 'true' && !config.hasCredentials()) {
    throw new Error('请设置 QQ_APP_ID / QQ_APP_SECRET，或先扫码绑定；仅运行网站时设置 QQBOT_ENABLED=false')
  }

  // 环境变量只更新管理员名单；密码与机器人密钥始终由进程环境读取。
  if (configuredQqs) {
    mkdirSync(dirname(configPath), { recursive: true })
    const next = `${JSON.stringify(admin, null, 2)}\n`
    if (!existsSync(configPath) || readFileSync(configPath, 'utf8') !== next) {
      const pending = `${configPath}.${process.pid}.tmp`
      writeFileSync(pending, next, { mode: 0o600 })
      renameSync(pending, configPath)
    }
  }
} catch (error) {
  console.error(`[config] ${error.message}`)
  process.exitCode = 1
}
