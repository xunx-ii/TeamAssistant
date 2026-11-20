import test from 'node:test'
import assert from 'node:assert/strict'

import { formatOperationLogActor, getOperationLogsForScope } from '../src/operationLogs.ts'

const logs = [
  { id: '1', teamId: 'team-1', teamName: '一团', timestamp: 3, actorQq: '10001', action: '报名 #1：甲' },
  { id: '2', teamId: 'team-2', teamName: '二团', timestamp: 2, actorQq: '10002', action: '退出 #1 报名' },
  { id: '3', teamId: '', teamName: '', timestamp: 1, actorQq: '10001', action: '修改昵称' },
  { id: '4', teamId: 'team-1', teamName: '一团', timestamp: 0, actorQq: '10001', action: '登记补贴' },
  { id: '5', teamId: 'team-1', teamName: '一团', timestamp: 4, actorQq: '10001', action: '指定 #1 报名：10003' },
]

test('team log scope excludes other teams and global profile logs', () => {
  assert.deepEqual(getOperationLogsForScope(logs, 'team', 'team-1').map(log => log.id), ['1', '5'])
  assert.deepEqual(getOperationLogsForScope(logs, 'team', 'missing'), [])
  assert.deepEqual(
    getOperationLogsForScope(logs, 'team', 'team-1', true).map(log => log.id),
    ['1', '4', '5'],
  )
})

test('all log scope hides sensitive actions from non-admin viewers', () => {
  assert.deepEqual(getOperationLogsForScope(logs, 'all', 'team-1').map(log => log.id), ['1', '2', '5'])
  assert.deepEqual(
    getOperationLogsForScope(logs, 'all', 'team-1', true).map(log => log.id),
    ['1', '2', '3', '4', '5'],
  )
})

test('log actor QQ is masked for non-admin viewers', () => {
  assert.equal(formatOperationLogActor('20001', false), '20***01')
  assert.equal(formatOperationLogActor('20***01', false), '20***01')
  assert.equal(formatOperationLogActor('20001', true), '20001')
  assert.equal(formatOperationLogActor('', true), '-')
})
