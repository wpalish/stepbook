import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import definition from "../module.js";
import { WorkStore } from "../core/store.js";

const guide = (name, status = "draft") => ({ name, owner: "SYNTHETIC owner", review: "2026-10-24", status });
const step = (parent, order, action = "SYNTHETIC action") => ({ guide: parent, order, action, result: "SYNTHETIC result", source: "" });
function save(store, collection, data, id) {
  const next = store.transact({ operation: "save", collection, data, id, revision: store.read().revision });
  return id || next.data[collection].at(-1).id;
}
const events = (store) => store.db.prepare("SELECT * FROM audit ORDER BY rowid").all();
function rejectUnchanged(store, command, pattern) {
  const before = store.read(), audit = events(store);
  assert.throws(() => store.transact({ ...command, revision: before.revision }), pattern);
  assert.deepEqual(store.read(), before);
  assert.deepEqual(events(store), audit);
}

test("expired published guide preserves history without blocking unrelated edits or archival", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-24T12:00:00Z") });
  const store = new WorkStore(definition);
  try {
    const id = save(store, "guides", guide("SYNTHETIC published history"));
    save(store, "steps", step(id, 1));
    save(store, "guides", guide("SYNTHETIC published history", "published"), id);
    const original = store.read().data.guides[0];
    t.mock.timers.setTime(Date.parse("2026-10-25T00:00:01Z"));
    const other = save(store, "guides", guide("SYNTHETIC other draft"));
    save(store, "steps", step(other, 1));
    assert.deepEqual(store.read().data.guides[0], original);
    rejectUnchanged(store, { operation: "save", collection: "guides", id: other,
      data: guide("SYNTHETIC other draft", "published") }, /истёк/);
    store.transact({ operation: "archive", collection: "guides", id, revision: store.read().revision });
    assert.equal(store.read().data.guides[0].status, "published");
    assert.equal(store.read().data.guides[0].review, original.review);
    assert.equal(store.read().data.guides[0].archived, true);
  } finally { store.close(); }
});

test("published source steps cannot be relocated into a draft even when the remaining sequence stays valid", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-24T12:00:00Z") });
  const folder = mkdtempSync(join(tmpdir(), "stepbook-protected-")), path = join(folder, "workspace.sqlite");
  let store = new WorkStore(definition, path);
  try {
    const source = save(store, "guides", guide("SYNTHETIC source")), dest = save(store, "guides", guide("SYNTHETIC draft"));
    save(store, "steps", step(source, 1));
    const second = save(store, "steps", step(source, 2));
    save(store, "guides", guide("SYNTHETIC source", "published"), source);
    const beforeRestart = store.read(); store.close(); store = new WorkStore(definition, path);
    assert.deepEqual(store.read(), beforeRestart);
    const move = { operation: "save", collection: "steps", id: second, data: step(dest, 1) };
    rejectUnchanged(store, move, /черновик/);
    rejectUnchanged(store, { ...move, data: step(dest, 1, "SYNTHETIC changed action") }, /черновик/);
    rejectUnchanged(store, { operation: "archive", collection: "steps", id: second }, /черновик/);
    const restored = new WorkStore(definition);
    try {
      restored.restore(store.export());
      assert.deepEqual(restored.read().data, store.read().data);
      rejectUnchanged(restored, move, /черновик/);
    } finally { restored.close(); }
    save(store, "guides", guide("SYNTHETIC source"), source);
    save(store, "steps", step(dest, 1), second);
    assert.equal(store.read().data.steps.find((x) => x.id === second).guide, dest);
    save(store, "steps", step(source, 2), second);
    save(store, "guides", guide("SYNTHETIC source", "published"), source);
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});

test("expired published guide restores after a date transition and requires a fresh date on republish", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-24T12:00:00Z") });
  const store = new WorkStore(definition), restored = new WorkStore(definition);
  try {
    const id = save(store, "guides", guide("SYNTHETIC restored history"));
    save(store, "steps", step(id, 1));
    save(store, "guides", guide("SYNTHETIC restored history", "published"), id);
    const copy = store.export();
    t.mock.timers.setTime(Date.parse("2026-10-26T12:00:00Z"));
    restored.restore(copy);
    assert.deepEqual(restored.read().data, store.read().data);
    save(restored, "guides", guide("SYNTHETIC new draft"));
    save(restored, "guides", guide("SYNTHETIC restored history"), id);
    rejectUnchanged(restored, { operation: "save", collection: "guides", id,
      data: guide("SYNTHETIC restored history", "published") }, /истёк/);
    save(restored, "guides", { ...guide("SYNTHETIC restored history", "published"), review: "2026-10-30" }, id);
  } finally { store.close(); restored.close(); }
});
