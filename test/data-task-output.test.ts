import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskPrompt, buildContinuePrompt } from "../src/prompts/task-prompt.js";
import { buildTaskResult } from "../src/manager/normalize.js";
import { providerFailureDiagnostic } from "../src/adapters/provider-failure.js";
import { zcodeTaskInputSchema, zcodeScheduleInputSchema, taskResultSchema } from "../src/mcp/schemas.js";
import { FakeAdapter, fakeOutcome, makeManagerFixture } from "./manager-helpers.js";
import { ScheduleController } from "../src/schedule/controller.js";
import { makeScheduleFixture, THREAD_ID } from "./schedule-helpers.js";
import type { ZCodeRunOutcome } from "../src/adapters/zcode-adapter.js";
import { BridgeError } from "../src/runtime/errors.js";

class DataAdapter extends FakeAdapter {
  constructor(readonly outcome: ZCodeRunOutcome) { super(); }
  override async getResult(): Promise<ZCodeRunOutcome> { return this.outcome; }
}

test("raw is opt-in, persists through worker/continuation, and never substitutes for acceptance", async () => {
  const f = await makeManagerFixture();
  try {
    const response = '[{"label":true},{"label":false}]';
    const task = f.makeTask({ report_mode: "raw", session_profile: "minimal", objective: "Return a label array", requirements: [], allowed_paths: [], acceptance_criteria: [] });
    const native = { ...fakeOutcome(), response, agentReport: null, reportCandidate: null };
    assert.doesNotMatch(buildTaskPrompt(task), /OUTPUT CONTRACT \(mandatory\)|Required fields: summary|DECISION RULE/);
    assert.match(buildTaskPrompt({ ...task, report_mode: undefined }), /OUTPUT CONTRACT \(mandatory\)/);
    assert.doesNotMatch(buildContinuePrompt({ task, feedback: "Update label", additionalRequirements: [], previousSessionId: null, previousResult: null }), /OUTPUT CONTRACT \(mandatory\)/);
    const receipt = await f.manager.createTask(task);
    await f.runWorker(task.task_id, new DataAdapter(native));
    const result = await f.manager.getResult(task.task_id);
    assert.equal(result.status, "completed"); assert.equal(result.zcode_output, response);
    assert.equal(result.acceptance_met, undefined); assert.equal(result.report_candidate, undefined);
    assert.deepEqual(result.tests, []); assert.equal(result.output_truncated, false);
    assert.deepEqual(f.store.readTask(task.task_id).report_mode, "raw");
    assert.deepEqual(await f.manager.createTask(task), receipt);
    await assert.rejects(f.manager.createTask({ ...task, report_mode: "structured" }), { code: "TASK_ID_CONFLICT" });
    await f.manager.continueTask({ task_id: task.task_id, feedback: "Update data" });
    await f.runWorker(task.task_id, new DataAdapter({ ...native, response: "[]" }));
    assert.equal((await f.manager.getResult(task.task_id)).attempt, 2); assert.equal((await f.manager.getResult(task.task_id)).zcode_output, "[]");
    assert.equal(f.store.readTask(task.task_id).session_profile, "minimal");
  } finally { await f.cleanup(); }
});

test("raw failure/cancellation/truncation never becomes completed and partial output is retained", async () => {
  const f = await makeManagerFixture();
  try {
    const task = f.makeTask({ report_mode: "raw" });
    for (const overrides of [{ errorCode: "zcode_nonzero_exit" as const }, { errorCode: "unknown_turn_terminal" as const }, { cancelled: true }, { timedOut: true }, { stdoutTruncated: true }, { exitCode: 1 }]) {
      const outcome = { ...fakeOutcome(), agentReport: null, reportCandidate: null, response: "PARTIAL", ...overrides };
      const result = buildTaskResult({ task, attempt: 1, startedAt: null, finishedAt: new Date().toISOString(), outcome });
      assert.notEqual(result.status, "completed"); assert.equal(result.zcode_output, "PARTIAL");
      if (outcome.stdoutTruncated) { assert.equal(result.error_code, "output_truncated"); assert.equal(result.output_truncated, true); }
    }
    const outcome = { ...fakeOutcome(), agentReport: null, reportCandidate: null, response: "[]" };
    const result = buildTaskResult({ task, attempt: 1, startedAt: null, finishedAt: new Date().toISOString(), outcome, failure: { code: "cleanup_failed", message: "unverified cleanup" } });
    assert.equal(result.error_code, "cleanup_failed"); assert.equal(result.status, "failed");
    assert.equal(taskResultSchema.parse(result).zcode_output, "[]");
    assert.equal(buildTaskResult({ task: { ...task, report_mode: undefined }, attempt: 1, startedAt: null, finishedAt: new Date().toISOString(), outcome }).error_code, "invalid_agent_report", "the existing strict coding contract remains the default");
  } finally { await f.cleanup(); }
});

test("data settings are validated for direct core callers as well as MCP; raw scheduled goals are rejected before persistence", async () => {
  const f = await makeManagerFixture(); const s = await makeScheduleFixture();
  try {
    for (const options of [{ report_mode: "typo" }, { session_profile: "typo" }]) {
      const task = { ...f.makeTask(), ...options };
      assert.equal(zcodeTaskInputSchema.safeParse(task).success, false);
      await assert.rejects(f.manager.createTask(task as never), { code: "TASK_INVALID" });
    }
    const input = { task: f.makeTask({ report_mode: "raw" }), start_at: "2026-11-10T12:00:00Z", thread_id: THREAD_ID };
    assert.equal(zcodeScheduleInputSchema.safeParse(input).success, false);
    const controller = new ScheduleController({ store: s.store, manager: s.manager, supervisor: s.supervisor, runnerEntryPath: "/runner.mjs", dataRoot: s.dataRoot, env: {} });
    await assert.rejects(controller.submit(input), { code: "SCHEDULE_INVALID" });
    assert.equal(s.store.hasSchedule(input.task.task_id), false); assert.equal(s.supervisor.plans.length, 0);
    assert.equal(f.store.listTaskIds().length, 0);
  } finally { await f.cleanup(); await s.cleanup(); }
});

test("provider projection exposes actionable classification and safe scalar fields without arbitrary provider text", () => {
  const diagnostic = providerFailureDiagnostic({ code: "UNKNOWN_ERROR", data: { error: { message: "[1301][unsafe][SECRET] https://private.invalid", retryable: false, status: 400, retry_after: 60 }, headers: { authorization: "SECRET" }, metadata: { message: "quota exhausted SECRET" } } });
  assert.match(diagnostic.summary, /content safety rejection \(1301\)/);
  assert.equal(diagnostic.details.code, "1301"); assert.equal(diagnostic.details.retryable, false);
  assert.equal(diagnostic.details.retry_after, 60); assert.equal(diagnostic.details.status, 400);
  for (const input of [diagnostic, providerFailureDiagnostic({ code: "sk-SECRET", message: "PRIVATE_PROMPT SECRET", retryable: "SECRET", data: { input: "SECRET" } })]) assert.doesNotMatch(JSON.stringify(input), /SECRET|PRIVATE|private.invalid/);
  assert.equal(providerFailureDiagnostic({ code: "content_filter" }).details.code, "content_filter", "do not invent a numeric business code for another provider");
  assert.equal(providerFailureDiagnostic({ metadata: { code: 1301 }, request: { message: "[1301]" } }).details.category, undefined);
});

test("idle healthy history leaves recovery without hiding newly queued work", async () => {
  const f = await makeManagerFixture();
  try {
    const now = new Date().toISOString();
    for (let i = 0; i < 20; i++) {
      const task = f.makeTask({ task_id: `history_${i}` });
      f.store.createTask(task, now); f.store.writeStatus(task.task_id, { status: "completed", worker_pid: null });
    }
    await f.manager.recoverTasks();
    const original = f.store.readStatus.bind(f.store); let reads = 0;
    f.store.readStatus = (...args) => { reads++; return original(...args); };
    await f.manager.recoverTasks();
    assert.equal(reads, 0, "after migration, healthy history must not consume recovery I/O");
    f.store.createTask(f.makeTask({ task_id: "abandoned_submission" }), now);
    await f.manager.recoverTasks();
    assert.equal(f.spawned.length, 1, "the next scan still discovers queued tasks created by another host");
    assert.equal(f.store.readStatus("abandoned_submission").status, "running");
  } finally { await f.cleanup(); }
});


test("raw checkpoint recovery preserves truncation rather than fabricating a complete response", async () => {
  for (const truncated of [false, true]) {
    const f = await makeManagerFixture();
    try {
      const task = f.makeTask({ report_mode: "raw" });
      await f.manager.createTask(task);
      f.pidsAlive.clear();
      f.store.writeAttemptMeta(task.task_id, 1, "outcome-checkpoint.json", {
        exit_code: 0, session_id: "raw-session", response: "[]", stdout_truncated: truncated,
        error_code: null, report_error: null, agent_report: null, report_candidate: null, cleanup_verified: true,
      });
      await f.manager.recoverTasks();
      const result = await f.manager.getResult(task.task_id);
      assert.equal(result.status, truncated ? "failed" : "completed");
      assert.equal(result.output_truncated, truncated); assert.equal(result.zcode_output, "[]");
      if (truncated) assert.equal(result.error_code, "output_truncated");
    } finally { await f.cleanup(); }
  }
});

test("provider evidence survives worker failure and cleanup priority without exposing arbitrary metadata", async () => {
  const evidence = { code: "1301", statusCode: 400, retryable: false, headers: { authorization: "SECRET" }, message: "PRIVATE_REQUEST_BODY" };
  class FailedAdapter extends FakeAdapter {
    override async getResult(): Promise<ZCodeRunOutcome> {
      throw new BridgeError("zcode_nonzero_exit", "provider rejected input", { providerError: evidence });
    }
  }
  const f = await makeManagerFixture();
  try {
    const task = f.makeTask({ report_mode: "raw" }); await f.manager.createTask(task);
    await f.runWorker(task.task_id, new FailedAdapter());
    const result = await f.manager.getResult(task.task_id);
    assert.equal(result.error_code, "zcode_nonzero_exit");
    assert.deepEqual(result.provider_error, { code: "1301", statusCode: 400, retryable: false, category: "content_filter" });
    assert.deepEqual(taskResultSchema.parse(result).provider_error, result.provider_error);
    assert.doesNotMatch(JSON.stringify(result), /SECRET|PRIVATE/);
    const cleanup = buildTaskResult({ task, attempt: 1, startedAt: null, finishedAt: new Date().toISOString(), outcome: { ...fakeOutcome(), providerError: evidence }, failure: { code: "cleanup_failed", message: "unverified cleanup" } });
    assert.equal(cleanup.error_code, "cleanup_failed", "diagnostics must not override cleanup occupancy");
    assert.deepEqual(cleanup.provider_error, result.provider_error);
    const quota = buildTaskResult({ task, attempt: 1, startedAt: null, finishedAt: new Date().toISOString(), outcome: null, failure: { code: "zcode_usage_exhausted", message: "quota", providerError: evidence } });
    assert.equal(quota.error_code, "zcode_usage_exhausted", "provider details cannot replace the stop-on-quota classification");
    const unknown = buildTaskResult({ task, attempt: 1, startedAt: null, finishedAt: new Date().toISOString(), outcome: null });
    assert.equal(unknown.provider_error, undefined, "absence is not a fabricated provider diagnosis");
  } finally { await f.cleanup(); }
});

test("checkpoint recovery retains sanitized provider diagnostics when a worker exits before result commit", async () => {
  const f = await makeManagerFixture();
  try {
    const task = f.makeTask({ report_mode: "raw" }); await f.manager.createTask(task); f.pidsAlive.clear();
    f.store.writeAttemptMeta(task.task_id, 1, "outcome-checkpoint.json", {
      exit_code: 1, session_id: "raw-session", response: "", error_code: "zcode_nonzero_exit",
      report_error: "provider failed", agent_report: null, cleanup_verified: true,
      provider_error: { code: "1301", statusCode: 400, retryable: false, headers: { authorization: "SECRET" } },
    });
    await f.manager.recoverTasks();
    const result = await f.manager.getResult(task.task_id);
    assert.equal(result.error_code, "zcode_nonzero_exit"); assert.equal(result.provider_error?.code, "1301");
    assert.doesNotMatch(JSON.stringify(result), /SECRET|authorization/);
  } finally { await f.cleanup(); }
});
