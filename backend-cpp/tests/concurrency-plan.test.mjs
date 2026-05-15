import test from 'node:test'
import assert from 'node:assert/strict'

test('C++ backend concurrency acceptance targets are documented', async () => {
  const docs = await import('node:fs/promises').then(fs => fs.readFile('docs/migration.md', 'utf8'))
  assert.match(docs, /30 concurrent saves/)
  assert.match(docs, /30 concurrent lock attempts/)
  assert.match(docs, /Successful member saves release/)
  assert.match(docs, /Slot locks and team runtime locks live in memory/)
})
