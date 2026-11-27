import test from "node:test";
import assert from "node:assert/strict";
import { createGroupMembershipSync } from "../src/group-sync.js";

test("group membership synchronization updates whitelist and notifies the group", async () => {
  const notifications = [];
  const synced = [];
  const sync = createGroupMembershipSync({
    oneBot: {
      isOpen: () => true,
      getGroupMembers: async () => [
        { user_id: 10001, nickname: "张三", card: "", role: "member", join_time: 1 },
        { user_id: 10002, nickname: "李四", card: "队长", role: "admin", join_time: 2 },
      ],
    },
    teamClient: {
      syncGroupMembers: async (groupId, members) => {
        synced.push({ groupId, members });
        return { ok: true, initialized: true, added: [], removed: [] };
      },
    },
    groupId: "1013228497",
    intervalMs: 60_000,
    notify: async message => notifications.push(message),
    logger: { info() {}, error() {} },
  });

  await sync.start();
  sync.stop();
  assert.equal(sync.size, 2);
  assert.equal(await sync.hasMember("10001"), true);
  assert.equal(await sync.hasMember("99999"), false);
  assert.equal(synced[0].groupId, "1013228497");
  assert.deepEqual(synced[0].members.map(member => member.qq), ["10001", "10002"]);
  assert.match(notifications[0], /共 2 人/);
});

test("removed members lose access without a public group announcement", async () => {
  const notifications = [];
  const logs = [];
  let requestCount = 0;
  const sync = createGroupMembershipSync({
    oneBot: {
      isOpen: () => true,
      getGroupMembers: async () => {
        requestCount += 1;
        return requestCount === 1
          ? [
              { user_id: 10001, nickname: "张三", card: "", role: "member", join_time: 1 },
              { user_id: 10002, nickname: "李四", card: "", role: "member", join_time: 2 },
            ]
          : [{ user_id: 10001, nickname: "张三", card: "", role: "member", join_time: 1 }];
      },
    },
    teamClient: {
      syncGroupMembers: async () => requestCount === 1
        ? { ok: true, initialized: true, added: [], removed: [] }
        : {
            ok: true,
            initialized: false,
            added: [],
            removed: [{ qq: "10002", nickname: "李四", card: "", role: "member" }],
          },
    },
    groupId: "1013228497",
    intervalMs: 60_000,
    notify: async message => notifications.push(message),
    logger: { info: message => logs.push(message), error() {} },
  });

  await sync.start();
  const notificationCount = notifications.length;
  await sync.refresh();
  sync.stop();

  assert.equal(sync.size, 1);
  assert.equal(await sync.hasMember("10002"), false);
  assert.equal(notifications.length, notificationCount);
  assert.equal(notifications.some(message => /李四|退出群/.test(message)), false);
  assert.equal(logs.some(message => /回收 1 名退群成员/.test(message)), true);
});
