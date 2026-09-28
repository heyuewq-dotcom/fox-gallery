import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBackup, validateBackup, restoreSummary } from "../src/backup.js";
const user = {
  sha256: "a".repeat(64),
  favorite: true,
  tags: ["old"],
  category: "mine",
  note: "keep",
  hidden: false,
  status: "custom",
};
test("backup round trip preserves user fields independently of filenames", () =>
  assert.deepEqual(validateBackup(makeBackup([user])), [user]));
test("malformed records reject the whole backup", () => {
  for (const bad of [
    { favorite: "yes" },
    { tags: "tag" },
    { note: null },
    { sha256: "invalid" },
    { category: 7 },
  ])
    assert.throws(() =>
      validateBackup(makeBackup([user, { ...user, ...bad }])),
    );
});
test("future versions and duplicate keys fail", () => {
  assert.throws(() =>
    validateBackup({ ...makeBackup([user]), schemaVersion: 99 }),
  );
  assert.throws(() => validateBackup(makeBackup([user, user])));
});
test("v0 notes migrate without dropping fields", () => {
  const old = { ...user, notes: "legacy" };
  delete old.note;
  assert.equal(
    validateBackup({ ...makeBackup([old]), schemaVersion: 0 })[0].note,
    "legacy",
  );
});
test("orphans and conflicts are reported by content hash", () =>
  assert.deepEqual(
    restoreSummary([user], new Map(), new Map([[user.sha256, user]])),
    { total: 1, matched: 0, orphans: 1, conflicts: 1 },
  ));
