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
