import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { registerUser, setupTestEnv, skipWithoutDb, type TestEnv } from "../test-helpers.js";
import { pruneStale } from "./retention.js";

describe("удаление старых сеансов и кодов", { skip: skipWithoutDb }, () => {
  let env: TestEnv;
  before(async () => {
    env = await setupTestEnv();
  });
  after(async () => {
    await env.close();
  });

  test("старые завершённые и истёкшие сеансы удаляются, активные остаются", async () => {
    const user = await registerUser(env);
    const sql = env.database.sql;
    const [active] = await sql<{ id: string }[]>`SELECT id FROM sessions WHERE user_id = ${user.user.id}`;
    assert.ok(active, "сеанс после регистрации");
    const insert = async (revokedDaysAgo: number | null, expiresDaysAgo: number) => {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO sessions (user_id, token_hash, expires_at, revoked_at)
        VALUES (${user.user.id}, ${`hash-${Math.random()}`}, now() - make_interval(days => ${expiresDaysAgo}::int),
                ${revokedDaysAgo === null ? null : sql`now() - make_interval(days => ${revokedDaysAgo}::int)`})
        RETURNING id`;
      return row!.id;
    };
    const oldRevoked = await insert(40, -10);
    const recentRevoked = await insert(5, -10);
    const oldExpired = await insert(null, 31);
    const recentExpired = await insert(null, 2);

    const removed = await pruneStale(sql);
    assert.equal(removed.sessions, 2);
    const left = (await sql<{ id: string }[]>`SELECT id FROM sessions WHERE user_id = ${user.user.id}`).map((r) => r.id).sort();
    assert.deepEqual(left, [active.id, recentRevoked, recentExpired].sort());
    assert.ok(!left.includes(oldRevoked) && !left.includes(oldExpired));

    // Код подтверждения из письма при регистрации ещё действует — остаётся.
    const [codes] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM email_codes WHERE user_id = ${user.user.id}`;
    assert.equal(codes?.count, 1);
  });
});
