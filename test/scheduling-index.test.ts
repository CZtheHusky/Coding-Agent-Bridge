// The registry narrows I/O, never certifies task state or executor cleanup.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { TaskStore } from "../src/store/task-store.js";
import { makeTask, makeTempDir, removeTempDir } from "./helpers.js";
import { FakeAdapter, makeManagerFixture } from "./manager-helpers.js";
import { BridgeTaskManager } from "../src/manager/task-manager.js";
import { DirectWorkspaceProvider } from "../src/workspace/direct-provider.js";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const AT = "2026-11-10T00:00:00.000Z";

test("migration does not invent an orphan candidate for legacy history removed during enumeration", async () => {
  const root = await makeTempDir("index-removed-history");
  try {
    const store = new TaskStore(root);
    store.createTask(makeTask(), AT);
    const list = store.listTaskIds.bind(store);
    store.listTaskIds = () => [...list(), "removed_history"];
    await store.initializeSchedulingIndex();
    assert.deepEqual(store.listSchedulingTaskIds(), ["task_1"]);
  } finally { await removeTempDir(root); }
});

test("legacy history removed during validation does not become an unknown-scope candidate", async () => {
  const root = await makeTempDir("index-removed-during-validation");
  try {
    const store = new TaskStore(root);
    store.createTask(makeTask(), AT);
    rmSync(path.join(store.tasksRoot, ".scheduling"), { recursive: true });
    store.readTask = () => { rmSync(store.taskDir("task_1"), { recursive: true }); throw new Error("legacy history removed"); };
    await store.initializeSchedulingIndex();
    assert.deepEqual(store.listSchedulingTaskIds(), []);
  } finally { await removeTempDir(root); }
});

test("legacy migration retains corrupt and unverified tasks without retaining healthy history", async () => {
  const root = await makeTempDir("index-migration");
  try {
    const store = new TaskStore(root);
    for (const id of ["healthy", "queued", "unclean", "corrupt"]) store.createTask(makeTask({ task_id: id }), AT);
    store.writeStatus("healthy", { status: "completed" });
    store.writeStatus("unclean", { status: "failed", cleanup_unverified: true });
    writeFileSync(path.join(store.taskDir("corrupt"), "status.json"), "broken");
    rmSync(path.join(store.tasksRoot, ".scheduling"), { recursive: true });
    await store.initializeSchedulingIndex();
    assert.deepEqual(store.listSchedulingTaskIds().sort(), ["corrupt", "queued", "unclean"]);
    assert.equal(store.readStatus("healthy").status, "completed", "history stays queryable");
    assert.throws(() => store.readSchedulingStatus("corrupt"));
    assert.ok(store.listSchedulingTaskIds().includes("corrupt"), "failed validation never frees its workspace");
    assert.equal(store.readSchedulingStatus("unclean").cleanup_unverified, true);
    assert.ok(store.listSchedulingTaskIds().includes("unclean"));
  } finally { await removeTempDir(root); }
});

test("status publication fails before changing state if candidate registration fails", async () => {
  const root = await makeTempDir("index-publication");
  try {
    const store = new TaskStore(root);
    store.createTask(makeTask(), AT);
    const statusFile = path.join(store.taskDir("task_1"), "status.json");
    const before = readFileSync(statusFile, "utf8");
    rmSync(path.join(store.tasksRoot, ".scheduling"), { recursive: true });
    writeFileSync(path.join(store.tasksRoot, ".scheduling"), "blocked");
    assert.throws(() => store.writeStatus("task_1", { status: "running" }));
    assert.equal(readFileSync(statusFile, "utf8"), before);
  } finally { await removeTempDir(root); }
});

test("independent stores re-register terminal cleanup changes and continuations", async () => {
  const root = await makeTempDir("index-cross-store");
  try {
    const reader = new TaskStore(root), writer = new TaskStore(root);
    reader.createTask(makeTask(), AT);
    reader.writeStatus("task_1", { status: "completed" });
    await reader.initializeSchedulingIndex();
    reader.readSchedulingStatus("task_1");
    assert.deepEqual(reader.listSchedulingTaskIds(), []);
    writer.writeStatus("task_1", { cleanup_unverified: true });
    assert.deepEqual(reader.listSchedulingTaskIds(), ["task_1"]);
    assert.equal(reader.readSchedulingStatus("task_1").cleanup_unverified, true);
    writer.writeStatus("task_1", { cleanup_unverified: false });
    reader.readSchedulingStatus("task_1");
    writer.writeStatus("task_1", { status: "queued", attempt: 2 });
    assert.equal(reader.readSchedulingStatus("task_1").attempt, 2);
    assert.deepEqual(reader.listSchedulingTaskIds(), ["task_1"]);
  } finally { await removeTempDir(root); }
});

test("missing or corrupt migration markers rebuild without discarding existing candidates", async () => {
  const root = await makeTempDir("index-rebuild");
  try {
    const store = new TaskStore(root);
    store.createTask(makeTask(), AT);
    await store.initializeSchedulingIndex();
    const ready = path.join(store.tasksRoot, ".scheduling", ".ready.json");
    for (const invalid of ["{", "{}"] ) {
      writeFileSync(ready, invalid);
      await new TaskStore(root).initializeSchedulingIndex();
      assert.deepEqual(store.listSchedulingTaskIds(), ["task_1"]);
    }
    rmSync(path.join(store.tasksRoot, ".scheduling"), { recursive: true });
    await store.initializeSchedulingIndex();
    assert.deepEqual(store.listSchedulingTaskIds(), ["task_1"]);
    writeFileSync(ready, JSON.stringify({ version: 2 }));
    await assert.rejects(store.initializeSchedulingIndex(), /upgrade all Bridge managers together/);
  } finally { await removeTempDir(root); }
});

test("a marker published before a failed status write remains conservatively occupied", async () => {
  const root = await makeTempDir("index-incomplete-create");
  try {
    const store = new TaskStore(root);
    await store.initializeSchedulingIndex();
    writeFileSync(path.join(store.tasksRoot, ".scheduling", "incomplete"), "");
    mkdirSync(path.join(store.tasksRoot, "incomplete"));
    assert.throws(() => store.readSchedulingStatus("incomplete"));
    assert.ok(store.listSchedulingTaskIds().includes("incomplete"));
    assert.equal(existsSync(path.join(store.tasksRoot, ".scheduling", "incomplete")), true);
  } finally { await removeTempDir(root); }
});

test("terminal pruning cannot remove a continuation published by another process", { timeout: 15_000 }, async () => {
  const root = await makeTempDir("index-prune-race");
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const store = new TaskStore(root);
    store.createTask(makeTask(), AT);
    store.writeStatus("task_1", { status: "completed" });
    await store.initializeSchedulingIndex();
    const signal = path.join(root, "terminal-read"), ready = path.join(root, "writer-ready");
    const source = `
      import {TaskStore} from ${JSON.stringify(new URL("../src/store/task-store.js", import.meta.url).href)};
      import {writeFileSync,existsSync} from 'node:fs';
      const store=new TaskStore(${JSON.stringify(root)}), read=store.readStatus.bind(store);
      let reads=0;
      store.readStatus=(id)=>{const s=read(id);if(s.status==='completed' && ++reads===2){
        writeFileSync(${JSON.stringify(signal)},'');
        const deadline=Date.now()+5000;
        while(!existsSync(${JSON.stringify(ready)})){if(Date.now()>deadline)throw Error('writer did not start');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);
      }return s;};
      store.readSchedulingStatus('task_1');
    `;
    child = spawn(process.execPath, ["--input-type=module", "--eval", source], { stdio: "ignore" });
    const exited = new Promise<number | null>((resolve, reject) => { child!.once("exit", resolve); child!.once("error", reject); });
    const deadline = Date.now() + 5_000;
    while (!existsSync(signal)) { assert.ok(Date.now() < deadline, "pruner must reach its terminal snapshot"); await delay(10); }
    writeFileSync(ready, "");
    store.writeStatus("task_1", { status: "queued", attempt: 2 });
    assert.equal(await exited, 0);
    assert.equal(store.readStatus("task_1").status, "queued");
    assert.deepEqual(store.listSchedulingTaskIds(), ["task_1"], "a stale terminal read must not hide the continuation");
  } finally { child?.kill(); await removeTempDir(root); }
});

test("another manager sees new work and same-session continuation after history was pruned", async () => {
  const fx = await makeManagerFixture();
  const other = new BridgeTaskManager({ store: new TaskStore(fx.dataRoot), workspaceProvider: new DirectWorkspaceProvider(), pollIntervalMs: 0, isProcessRunning: (pid) => fx.pidsAlive.has(pid), spawnWorker: (_root, taskId) => { fx.pidsAlive.add(90001); fx.spawned.push({ dataRoot: fx.dataRoot, taskId, pid: 90001 }); return { pid: 90001 }; } });
  try {
    await other.recoverTasks();
    await fx.manager.createTask(fx.makeTask());
    await fx.runWorker("task_1", new FakeAdapter());
    await other.recoverTasks();
    assert.deepEqual(fx.store.listSchedulingTaskIds(), []);
    await fx.manager.continueTask({ task_id: "task_1", feedback: "Continue the same task" });
    assert.equal(fx.store.readStatus("task_1").attempt, 2);
    assert.deepEqual(fx.store.listSchedulingTaskIds(), ["task_1"]);
    assert.equal((await other.getStatus("task_1")).status, "running");
  } finally { other.dispose(); await fx.cleanup(); }
});
