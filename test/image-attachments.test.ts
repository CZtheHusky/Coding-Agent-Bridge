import assert from "node:assert/strict";
import test from "node:test";
import { writeFile, rm, realpath } from "node:fs/promises";
import path from "node:path";
import { resolveImageAttachments } from "../src/attachments/images.js";
import { zcodeTaskInputSchema, zcodeContinueInputSchema } from "../src/mcp/schemas.js";
import { buildTaskPrompt, buildContinuePrompt } from "../src/prompts/task-prompt.js";
import { makeManagerFixture, FakeAdapter } from "./manager-helpers.js";
import { runWorkerTask } from "../src/worker/run-task.js";
import type { CodingAgentAdapter } from "../src/interfaces.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");

test("native attachments accept only local image descriptors at both MCP entry points", async () => {
  const f = await makeManagerFixture();
  try {
    const attachments = [{ path: path.join(f.workspaceDir, "图.png") }];
    assert.deepEqual(zcodeTaskInputSchema.parse(f.makeTask({ attachments })).attachments, attachments);
    assert.deepEqual(zcodeContinueInputSchema.parse({ task_id: "t", feedback: "inspect", attachments }).attachments, attachments);
    for (const attachments of [[{ path: "relative.png" }], [{ url: "https://example.com/image.png" }], [{ path: "/image.png", data: "secret" }], ["/image.png"], null]) {
      assert.equal(zcodeTaskInputSchema.safeParse({ ...f.makeTask(), attachments }).success, false);
      assert.equal(zcodeContinueInputSchema.safeParse({ task_id: "t", feedback: "x", attachments }).success, false);
    }
  } finally { await f.cleanup(); }
});

test("MIME comes from image signatures, batch order is retained, and file contents stay out of prompts", async () => {
  const f = await makeManagerFixture();
  try {
    const signatures = [png, Buffer.from("ffd8ffe00000", "hex"), Buffer.from("GIF89a123456"), Buffer.from("RIFF0000WEBP")];
    const attachments = [];
    for (let i = 0; i < 16; i++) {
      const name = path.join(f.workspaceDir, `图 ${15 - i}.bin`);
      await writeFile(name, signatures[i % 4]!); attachments.push({ path: name });
    }
    const images = await resolveImageAttachments(attachments);
    assert.deepEqual(images.map(x => x.path), await Promise.all(attachments.map(x => realpath(x.path))));
    assert.deepEqual(images.slice(0, 4).map(x => x.mimeType), ["image/png", "image/jpeg", "image/gif", "image/webp"]);
    const prompt = buildTaskPrompt(f.makeTask({ attachments }));
    assert.match(prompt, /1\. "图 15.bin"/);
    assert.doesNotMatch(prompt, new RegExp(png.toString("base64")));
    assert.deepEqual(await resolveImageAttachments(), []);
    assert.deepEqual(await resolveImageAttachments([]), []);
  } finally { await f.cleanup(); }
});

test("invalid images fail before task persistence and dispatch, rather than silently dropping them", async () => {
  const f = await makeManagerFixture();
  try {
    const invalid = path.join(f.workspaceDir, "pretend.png"); await writeFile(invalid, "PRIVATE_TEXT_MUST_NOT_LEAK");
    for (const imagePath of [invalid, f.workspaceDir, path.join(f.workspaceDir, "missing.png")]) {
      await assert.rejects(f.manager.createTask(f.makeTask({ attachments: [{ path: imagePath }] })), error => {
        assert.equal((error as { code: string }).code, "TASK_INVALID");
        assert.doesNotMatch(String(error), /PRIVATE_TEXT_MUST_NOT_LEAK/); return true;
      });
    }
    assert.deepEqual(f.store.listTaskIds(), []); assert.equal(f.spawned.length, 0);
  } finally { await f.cleanup(); }
});

test("attachment identity survives retries and persisted continuation, without resending original images", async () => {
  const f = await makeManagerFixture();
  try {
    const original = [{ path: path.join(f.workspaceDir, "original.png") }];
    const added = [{ path: path.join(f.workspaceDir, "added.png") }];
    for (const x of [...original, ...added]) await writeFile(x.path, png);
    const task = f.makeTask({ attachments: original });
    const receipt = await f.manager.createTask(task);
    await assert.rejects(f.manager.createTask({ ...task, attachments: added }), { code: "TASK_ID_CONFLICT" });
    await f.runWorker(task.task_id, new FakeAdapter());
    await rm(original[0]!.path);
    assert.deepEqual(await f.manager.createTask(task), receipt, "lost submission receipt is replayable even after the file is removed");
    const request = { task_id: task.task_id, feedback: "inspect new image", operation_id: "add-image", attachments: added };
    const continued = await f.manager.continueTask(request);
    assert.deepEqual(f.store.readAttemptMeta<{ attachments: unknown }>(task.task_id, 2, "continue.json")?.attachments, added);
    await assert.rejects(f.manager.continueTask({ ...request, attachments: original }), { code: "CONTINUE_OPERATION_CONFLICT" });
    await rm(added[0]!.path);
    assert.deepEqual(await f.manager.continueTask(request), continued, "replaying a committed operation must not revalidate a vanished file or dispatch twice");
    const adapter = new FakeAdapter(); let received: unknown;
    const capture = adapter.continueTask.bind(adapter);
    adapter.continueTask = async (input: Parameters<CodingAgentAdapter["continueTask"]>[0]) => { received = input.attachments; return capture(input); };
    await runWorkerTask({ dataRoot: f.dataRoot, taskId: task.task_id, attempt: 2, adapter });
    assert.deepEqual(received, added, "a fresh worker must recover only this attempt's attachments");
    const prompt = f.store.readAttemptText(task.task_id, 2, "prompt.txt")!;
    assert.match(prompt, /1\. "added.png"/); assert.doesNotMatch(prompt, /original.png/);
    await assert.rejects(f.manager.continueTask({ task_id: task.task_id, feedback: "missing image", attachments: added }), { code: "TASK_INVALID" });
    assert.equal(f.store.readStatus(task.task_id).attempt, 2, "bad follow-up images must not erase the prior result or consume an attempt");
    assert.ok(f.store.readResult(task.task_id));
    const noImages = buildContinuePrompt({ task, feedback: "continue", additionalRequirements: [], previousSessionId: "session", previousResult: null });
    assert.doesNotMatch(noImages, /IMAGES ATTACHED|original.png/);
  } finally { await f.cleanup(); }
});

for (const executor of ["zcode", "kimi"] as const) test(`a queued ${executor} task whose image disappears persists attachment_invalid`, async () => {
  const f = await makeManagerFixture();
  try {
    const imagePath = path.join(f.workspaceDir, "temporary.png"); await writeFile(imagePath, png);
    const task = f.makeTask({ executor, attachments: [{ path: imagePath }] });
    await f.manager.createTask(task);
    await rm(imagePath);
    const run = await runWorkerTask({ dataRoot: f.dataRoot, taskId: task.task_id, attempt: 1 });
    assert.equal(run.status, "failed");
    assert.equal(run.result.error_code, "attachment_invalid");
    assert.equal(f.store.readResult(task.task_id)?.error_code, "attachment_invalid");
    assert.equal(f.store.readStatus(task.task_id).cleanup_unverified ?? false, false);
    assert.equal(f.store.readStatus(task.task_id).worker_pid, null);
    assert.doesNotMatch(f.store.readLog(task.task_id, "stderr"), /iVBORw0KGgo/);
  } finally { await f.cleanup(); }
});
