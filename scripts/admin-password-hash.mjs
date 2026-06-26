import { createHash, randomBytes } from 'node:crypto'

const password = process.argv[2]
const salt = process.argv[3] ?? randomBytes(16).toString('hex')

if (!password) {
  console.error('Usage: node scripts/admin-password-hash.mjs <password> [salt]')
  process.exit(1)
}

const hash = createHash('sha256').update(`${salt}${password}`).digest('hex').toUpperCase()

console.log(JSON.stringify({
  adminPasswordSalt: salt,
  adminPasswordHash: hash,
}, null, 2))
