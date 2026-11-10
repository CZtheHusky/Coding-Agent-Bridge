import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { ZCodeAppServerAdapter } from "../src/adapters/zcode-app-server-adapter.js";
import { isProcessRunning } from "../src/adapters/process-spawn.js";
import { BridgeError } from "../src/runtime/errors.js";
import { buildTaskResult } from "../src/manager/normalize.js";
import type { TaskPackage, ZCodeRuntimeConfig } from "../src/interfaces.js";
import { makeWorkspace, SESSION_ID, validReport } from "./helpers.js";

const task: TaskPackage = {
  task_id: "model_override_test",
  workspace: "C:\\unused",
  objective: "Return the requested report",
  requirements: [],
  allowed_paths: [],
  forbidden_paths: [],
  acceptance_criteria: [],
  test_commands: [],
};

async function makeFakeRuntime(
  selectedModel: { providerId: string; modelId: string; options?: { reasoningLevel: string } } = { providerId: "provider-default", modelId: "model-default" },
  includeRequestedModel = true,
  interactionRequest = false,
  turnFailure?: unknown,
  failureDelivery: "event" | "rpc" = "event",
  terminal: { response?: string; resultType?: string | null; coalescedTurnStart?: boolean } = {},
): Promise<{ root: string; config: ZCodeRuntimeConfig; requestLog: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "bridge-app-server-test-"));
  const entrypoint = path.join(root, "fake-app-server.cjs");
  const requestLog = path.join(root, "requests.jsonl");
  const script = String.raw`
const readline = require("node:readline");
const fs = require("node:fs");
const sessionId = ${JSON.stringify(SESSION_ID)};
const requestLog = ${JSON.stringify(requestLog)};
let selected = ${JSON.stringify(selectedModel)};
const turnFailure = ${JSON.stringify(turnFailure ?? null)};
const available = [selected, ${includeRequestedModel ? '{ providerId: "provider-123", modelId: "model-x" }, { providerId: "provider-123", modelId: "reasoning-model" }' : ""}];
const report = ${JSON.stringify(validReport())};
let turnFinished = false;
function finishTurn(ackId) {
  if (turnFinished) return;
  turnFinished = true;
  const params = turnFailure === null
    ? { seq: ${terminal.coalescedTurnStart ? 2 : 1}, type: "turn.completed", payload: { response: ${terminal.response === undefined ? "JSON.stringify(report)" : JSON.stringify(terminal.response)}, usage: { totalTokens: 4 }, resultType: ${JSON.stringify(terminal.resultType === undefined ? "success" : terminal.resultType)} } }
    : { seq: 1, type: "turn.failed", payload: { error: turnFailure } };
  const frames = [{ method: "session/event", params }];
  if (ackId !== undefined) frames.unshift(
    { id: ackId, result: {} },
    { method: "session/event", params: { sessionId, seq: 1, type: "turn.started", payload: { turnId: "coalesced-turn" } } },
  );
  process.stdout.write(frames.map(frame => JSON.stringify(frame)).join("\n") + "\n");
}
function snapshot() {
  return {
    session: { sessionId },
    settings: { model: { current: selected, available: available.map((ref) => ({ ref, label: "Test Model" })) } },
    runtime: { eventSeq: 0 },
  };
}
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  fs.appendFileSync(requestLog, JSON.stringify(message) + "\n");
  if (message.method === "session/create" || message.method === "session/resume") {
    process.stdout.write(JSON.stringify({ id: message.id, result: snapshot() }) + "\n");
  } else if (message.method === "session/setMode") {
    process.stdout.write(JSON.stringify({ id: message.id, result: snapshot() }) + "\n");
  } else if (message.method === "session/setModel") {
    selected = message.params.model;
    process.stdout.write(JSON.stringify({ id: message.id, result: snapshot() }) + "\n");
  } else if (message.method === "session/usage") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { sessionId, modelRequestCount: 7, modelErrorCount: 2, inputTokens: 120, outputTokens: 12, privateField: "HIDDEN_USAGE" } }) + "\n");
  } else if (message.method === "session/subscribe") {
    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\n");
  } else if (message.method === "session/send") {
    if (${failureDelivery === "rpc"} && turnFailure !== null) {
      process.stdout.write(JSON.stringify({ id: message.id, error: turnFailure }) + "\n");
      return;
    }
    if (${terminal.coalescedTurnStart === true}) {
      finishTurn(message.id);
      return;
    }
    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\n");
    if (${interactionRequest}) {
      for (const rpcId of ["interaction-rpc-1", "interaction-rpc-2"]) {
        process.stdout.write(JSON.stringify({ id: rpcId, method: "interaction/requestPermission", params: {
          requestId: "permission-1", sessionId, toolCallId: "call-1", toolName: "Bash",
          reason: "Run a build command", input: { command: "npm run build" },
          options: [{ kind: "allow_once" }, { kind: "deny" }]
        }}) + "\n");
      }
    } else {
      finishTurn();
    }
  } else if (message.id === "interaction-rpc-1" || message.id === "interaction-rpc-2") {
    if (message.result && message.result.decision) finishTurn();
  } else {
    process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32601, message: "unsupported" } }) + "\n");
  }
});
`;
  await writeFile(entrypoint, script, "utf8");
  return {
    root,
    requestLog,
    config: {
      nodeExecutable: process.execPath,
      zcodeEntrypoint: entrypoint,
      providerBuiltinConfigFile: path.join(root, "builtin.json"),
      providerPersonalConfigFile: path.join(root, "personal.json"),
      dataRoot: root,
    },
  };
}

for (const coalescedTurnStart of [true, false]) {
  test(coalescedTurnStart
    ? "coalesced ACK and runtime turn.started publish one start for the accepted turn"
    : "an ACK without runtime turn.started still publishes the compatibility start", async () => {
    const runtime = await makeFakeRuntime(undefined, true, false, undefined, "event", { coalescedTurnStart });
    const events: Array<{ type: string; details?: Record<string, unknown> }> = [];
    try {
      const adapter = new ZCodeAppServerAdapter({
        resolver: { resolve: async () => runtime.config },
        homeDir: runtime.root,
        onEvent: event => events.push(event),
        timeoutMs: 10_000,
        childEnvBase: { PATH: process.env.PATH },
      });
      const handle = await adapter.startTask({ task, workspace: makeWorkspace(runtime.root), attempt: 1 });
      const result = await adapter.getResult(handle);
      assert.equal(result.exitCode, 0);
      assert.equal(result.cleanupVerified, true);
      const starts = events.filter(event => event.type === "turn_started");
      assert.equal(starts.length, 1, "one accepted turn must retain its start evidence without duplicating a coalesced runtime start");
      if (coalescedTurnStart) {
        assert.equal(starts[0]!.details?.["turn_id"], "coalesced-turn");
        assert.equal(starts[0]!.details?.["rpc_accepted"], undefined);
      } else {
        assert.equal(starts[0]!.details?.["rpc_accepted"], true);
      }
    } finally {
      await rm(runtime.root, { recursive: true, force: true });
    }
  });
}

test("applies a per-task model override, verifies the selection, and does not persist it as the workspace default", async () => {
  const runtime = await makeFakeRuntime();
  const events: Array<{ type: string; summary: string; details?: Record<string, unknown> }> = [];
  try {
    const adapter = new ZCodeAppServerAdapter({
      resolver: { resolve: async () => runtime.config },
      onEvent: (event) => events.push(event),
      timeoutMs: 10_000,
      childEnvBase: { PATH: process.env.PATH },
    });
    const handle = await adapter.startTask({
      task: { ...task, model: { provider_id: "provider-123", model_id: "model-x" } },
      workspace: makeWorkspace(runtime.root),
      attempt: 1,
    });
    const result = await adapter.getResult(handle);
    assert.equal(result.exitCode, 0);
    assert.equal(result.sessionId, SESSION_ID);
    const requests = (await readFile(runtime.requestLog, "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    const create = requests.find((request) => request.method === "session/create")!.params as Record<string, unknown>;
    for (const key of ["toolAllowlist", "mcpServers", "dynamicWorkflowEnabled", "offPeakToolEnabled", "titleGenerationEnabled", "systemPrompt"]) assert.equal(create[key], undefined, "default tasks retain the native prompt and tools");
    const setModel = requests.find((request) => request.method === "session/setModel");
    assert.ok(setModel);
    assert.deepEqual(setModel.params, {
      sessionId: SESSION_ID,
      model: { providerId: "provider-123", modelId: "model-x" },
      persistAsWorkspaceLastUsed: false,
    });
    assert.ok(events.some((event) => event.type === "model_selected" && event.details?.["model_id"] === "model-x"));
    assert.ok(events.some((event) => event.type === "session_ready" && String(event.details?.["selected_model"]).includes("provider-123/model-x")));
  } finally {
    await rm(runtime.root, { recursive: true, force: true });
  }
});

test("classifies explicit provider usage exhaustion without publishing its raw error", async () => {
  const privateMarker = "PRIVATE_PROVIDER_DETAIL_7f4b";
  const runtime = await makeFakeRuntime(undefined, true, false, {
    code: "insufficient_quota",
    type: "usage_limit_error",
    message: `Account usage quota exhausted; ${privateMarker}`,
  });
  const events: Array<{ type: string; summary: string; details?: Record<string, unknown> }> = [];
  try {
    const adapter = new ZCodeAppServerAdapter({
      resolver: { resolve: async () => runtime.config },
      onEvent: (event) => events.push(event),
      timeoutMs: 10_000,
      childEnvBase: { PATH: process.env.PATH },
    });
    const handle = await adapter.startTask({ task, workspace: makeWorkspace(runtime.root), attempt: 1 });
    await assert.rejects(adapter.getResult(handle), (error: unknown) => {
      assert.ok(error instanceof BridgeError);
      assert.equal(error.code, "zcode_usage_exhausted");
      assert.match(error.message, /额度已耗尽；当前执行已中断/);
      assert.match(error.message, /立即停止当前任务并告知用户/);
      assert.match(error.message, /不要继续工作、自动重试或续作/);
      assert.match(error.message, /等待用户确认额度恢复后再继续/);
      return true;
    });
    const failureEvents = events.filter((event) => event.type === "turn_failed" || event.type === "error");
    assert.equal(failureEvents.length, 2);
    assert.ok(failureEvents.every((event) => event.details?.error_code === "zcode_usage_exhausted"));
    assert.match(failureEvents[0]!.summary, /用量额度已耗尽/);
    assert.match(failureEvents[0]!.summary, /当前执行已中断/);
    assert.match(failureEvents[0]!.summary, /立即停止当前任务并告知用户/);
    assert.match(failureEvents[0]!.summary, /等待用户确认额度恢复/);
    assert.doesNotMatch(JSON.stringify({ events, message: failureEvents.map((event) => event.summary) }), new RegExp(privateMarker));
  } finally {
    await rm(runtime.root, { recursive: true, force: true });
  }
});

test("does not misclassify request rate limits or generic 429s as exhausted usage", async () => {
  const cases = [
    { code: "rate_limit_exceeded", message: "Rate limit exceeded; retry after 60 seconds" },
    { code: "429", message: "Too many requests" },
  ];
  for (const providerError of cases) {
    const runtime = await makeFakeRuntime(undefined, true, false, providerError);
    const events: Array<{ type: string; summary: string; details?: Record<string, unknown> }> = [];
    try {
      const adapter = new ZCodeAppServerAdapter({
        resolver: { resolve: async () => runtime.config },
        onEvent: (event) => events.push(event),
        timeoutMs: 10_000,
        childEnvBase: { PATH: process.env.PATH },
      });
      const handle = await adapter.startTask({ task, workspace: makeWorkspace(runtime.root), attempt: 1 });
      await assert.rejects(adapter.getResult(handle), (error: unknown) => {
        assert.ok(error instanceof BridgeError);
        assert.equal(error.code, "zcode_nonzero_exit");
        assert.match(error.message, /^ZCode turn failed/);
        return true;
      });
      const failureEvents = events.filter((event) => event.type === "turn_failed" || event.type === "error");
      assert.equal(failureEvents.length, 2);
      assert.ok(failureEvents.every((event) => event.details?.error_code === "zcode_nonzero_exit"));
    } finally {
      await rm(runtime.root, { recursive: true, force: true });
    }
  }
});

test("provider quota diagnostics survive ZCode wrappers and RPC rejection without leaking raw fields", async (t) => {
  const privateMarker = "PRIVATE_QUOTA_CONTEXT_011";
  const cases: Array<{ name: string; error: unknown; provider?: string; delivery?: "event" | "rpc" }> = [
    { name: "five-hour business code with generic message", provider: "account:bigmodel-individual-coding-plan", error: { code: "1308", message: "Model request failed" } },
    { name: "provider attribution carries the business code", error: { type: "MODEL_RATE_LIMITED", message: "Model request failed", attribution: { providerId: "account:zai-start-plan", providerErrorCode: "1316" } } },
    { name: "Chinese five-hour detail", error: { message: "Turn execution failed", detail: "已达到 5 小时使用上限。您的限额将在稍后重置。" } },
    { name: "underlying provider message", error: { message: "Turn execution failed", underlyingErrorMessage: "Account quota exhausted" } },
    { name: "underlying provider detail", error: { message: "Turn execution failed", underlyingErrorDetail: "Weekly/Monthly Limit Exhausted" } },
    { name: "credit balance error code", error: { code: "credit_balance_exhausted", message: "Model request failed" } },
    { name: "project spend cap error code", error: { code: "project_spend_limit_exceeded", message: "Model request failed" } },
    { name: "RPC send rejects before a turn event", delivery: "rpc", error: { code: -32603, message: "Usage limit reached for the past 5 hours" } },
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const error = typeof item.error === "object" && item.error !== null
      ? { ...item.error, stack: privateMarker, metadata: { authorization: privateMarker } }
      : item.error;
    const runtime = await makeFakeRuntime({ providerId: item.provider ?? "provider-default", modelId: "model-default" }, true, false, error, item.delivery);
    const events: Array<{ type: string; summary: string; details?: Record<string, unknown> }> = [];
    try {
      const adapter = new ZCodeAppServerAdapter({ resolver: { resolve: async () => runtime.config }, onEvent: (event) => events.push(event), timeoutMs: 10_000, childEnvBase: { PATH: process.env.PATH } });
      const handle = await adapter.startTask({ task, workspace: makeWorkspace(runtime.root), attempt: 1 });
      await assert.rejects(adapter.getResult(handle), (failure: unknown) => {
        assert.ok(failure instanceof BridgeError);
        assert.equal(failure.code, "zcode_usage_exhausted");
        assert.match(failure.message, /不要继续工作、自动重试或续作/);
        assert.doesNotMatch(failure.message, new RegExp(privateMarker));
        return true;
      });
      assert.ok(events.some((event) => event.type === "error" && event.details?.error_code === "zcode_usage_exhausted"));
      assert.doesNotMatch(JSON.stringify(events), new RegExp(privateMarker));
    } finally { await rm(runtime.root, { recursive: true, force: true }); }
  });
});

test("quota diagnostics do not infer exhaustion from rate limits, unrelated providers, or private metadata", async (t) => {
  const cases: Array<{ name: string; error: unknown; provider?: string; delivery?: "event" | "rpc" }> = [
    { name: "ZAI request rate limit", provider: "account:zai-start-plan", error: { code: "1302", message: "Rate limit reached for requests" } },
    { name: "ZAI overload", provider: "account:bigmodel-individual-coding-plan", error: { code: "1305", message: "Service overloaded" } },
    { name: "unrelated provider reuses code", error: { code: "1308", message: "Request failed" } },
    { name: "error attribution overrides selected provider", provider: "account:bigmodel-individual-coding-plan", error: { code: "1308", message: "Request failed", attribution: { providerId: "another-provider" } } },
    { name: "private metadata is not diagnostic input", error: { message: "Request failed", data: { error: { code: "insufficient_quota" } }, metadata: { message: "Quota exhausted" }, stack: "Quota exhausted" } },
    { name: "fields cannot form a synthetic quota claim", error: { code: "quota", message: "exceeded" } },
    { name: "RPC transport 429", delivery: "rpc", error: { code: 429, message: "Too many requests" } },
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const runtime = await makeFakeRuntime({ providerId: item.provider ?? "provider-default", modelId: "model-default" }, true, false, item.error, item.delivery);
    const events: Array<{ type: string; summary: string; details?: Record<string, unknown> }> = [];
    try {
      const adapter = new ZCodeAppServerAdapter({ resolver: { resolve: async () => runtime.config }, onEvent: (event) => events.push(event), timeoutMs: 10_000, childEnvBase: { PATH: process.env.PATH } });
      const handle = await adapter.startTask({ task, workspace: makeWorkspace(runtime.root), attempt: 1 });
      await assert.rejects(adapter.getResult(handle), (failure: unknown) => {
        assert.ok(failure instanceof BridgeError);
        assert.equal(failure.code, "zcode_nonzero_exit");
        return true;
      });
      assert.ok(events.every((event) => event.details?.error_code !== "zcode_usage_exhausted"));
    } finally { await rm(runtime.root, { recursive: true, force: true }); }
  });
});

test("lets the app-server resolve a requested model omitted from the initial catalog", async () => {
  const runtime = await makeFakeRuntime({ providerId: "provider-default", modelId: "model-default" }, false);
  try {
    const adapter = new ZCodeAppServerAdapter({
      resolver: { resolve: async () => runtime.config },
      timeoutMs: 10_000,
      childEnvBase: { PATH: process.env.PATH },
    });
    const handle = await adapter.startTask({
      task: { ...task, model: { provider_id: "account:zai-start-plan", model_id: "GLM-5.3-Flash" } },
      workspace: makeWorkspace(runtime.root),
      attempt: 1,
    });
    assert.equal((await adapter.getResult(handle)).exitCode, 0);
    const requests = (await readFile(runtime.requestLog, "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(requests.some((request) => request.method === "session/setModel"), true);
    assert.equal(requests.some((request) => request.method === "session/send"), true);
  } finally {
    await rm(runtime.root, { recursive: true, force: true });
  }
});

test("resolves an unprefixed provider from the runtime catalog without losing the caller request", async () => {
  const runtime = await makeFakeRuntime({ providerId: "account:plan", modelId: "flash", options: { reasoningLevel: "high" } }, false);
  try {
    const adapter = new ZCodeAppServerAdapter({ resolver: { resolve: async () => runtime.config }, timeoutMs: 10_000, childEnvBase: { PATH: process.env.PATH }, homeDir: runtime.root });
    const handle = await adapter.startTask({ task: { ...task, model: { provider_id: "plan", model_id: "flash", reasoning_level: "high" } }, workspace: makeWorkspace(runtime.root), attempt: 1 });
    const outcome = await adapter.getResult(handle);
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.modelProfile?.provider_id, "account:plan");
    assert.equal(outcome.modelProfile?.requested_model, "plan/flash");
    const requests = (await readFile(runtime.requestLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const selection = requests.find((request) => request.method === "session/setModel");
    assert.equal(selection.params.model.providerId, "account:plan");
    assert.equal(selection.params.persistAsWorkspaceLastUsed, false);
  } finally { await rm(runtime.root, { recursive: true, force: true }); }
});

test("omitting model leaves the ZCode session default untouched", async () => {
  const runtime = await makeFakeRuntime();
  try {
    // homeDir points at an empty directory so the machine's runtime-config.json
    // (which may carry a real user default model) cannot leak into the run.
    const adapter = new ZCodeAppServerAdapter({
      resolver: { resolve: async () => runtime.config },
      timeoutMs: 10_000,
      childEnvBase: { PATH: process.env.PATH },
      homeDir: runtime.root,
    });
    const handle = await adapter.startTask({ task, workspace: makeWorkspace(runtime.root), attempt: 1 });
    const result = await adapter.getResult(handle);
    assert.equal(result.exitCode, 0);
    const requests = (await readFile(runtime.requestLog, "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(requests.some((request) => request.method === "session/setModel"), false);
  } finally {
    await rm(runtime.root, { recursive: true, force: true });
  }
});

test("starts ZCode runtime without a Bridge-specific execution opt-in", async () => {
  const runtime = await makeFakeRuntime();
  try {
    const adapter = new ZCodeAppServerAdapter({
      resolver: { resolve: async () => runtime.config },
      childEnvBase: { PATH: process.env.PATH, PRIVATE_API_TOKEN: "not-forwarded" },
    });
    const handle = await adapter.startTask({ task, workspace: makeWorkspace(runtime.root), attempt: 1 });
    const result = await adapter.getResult(handle);
    assert.equal(result.exitCode, 0);
  } finally {
    await rm(runtime.root, { recursive: true, force: true });
  }
});

test("passes an explicit reasoning level when selecting a model that requires it", async () => {
  const runtime = await makeFakeRuntime();
  try {
    const adapter = new ZCodeAppServerAdapter({ resolver: { resolve: async () => runtime.config }, timeoutMs: 10_000, childEnvBase: { PATH: process.env.PATH } });
    const handle = await adapter.startTask({
      task: { ...task, model: { provider_id: "provider-123", model_id: "reasoning-model", reasoning_level: "high" } },
      workspace: makeWorkspace(runtime.root),
      attempt: 1,
    });
    const result = await adapter.getResult(handle);
    assert.equal(result.exitCode, 0);
    const requests = (await readFile(runtime.requestLog, "utf8"))
      .trim().split("\n").map((request) => JSON.parse(request) as Record<string, unknown>);
    const setModel = requests.find((request) => request.method === "session/setModel");
    assert.deepEqual((setModel?.params as Record<string, unknown>)?.["model"], {
      providerId: "provider-123",
      modelId: "reasoning-model",
      options: { reasoningLevel: "high" },
    });
  } finally {
    await rm(runtime.root, { recursive: true, force: true });
  }
});

test("keeps the runtime-selected reasoning options when the requested model is already active", async () => {
  const runtime = await makeFakeRuntime({ providerId: "provider-123", modelId: "model-x", options: { reasoningLevel: "high" } });
  const events: Array<{ type: string; summary: string; details?: Record<string, unknown> }> = [];
  try {
    const adapter = new ZCodeAppServerAdapter({
      resolver: { resolve: async () => runtime.config },
      onEvent: (event) => events.push(event),
      timeoutMs: 10_000,
      childEnvBase: { PATH: process.env.PATH },
    });
    const handle = await adapter.startTask({
      task: { ...task, model: { provider_id: "provider-123", model_id: "model-x" } },
      workspace: makeWorkspace(runtime.root),
      attempt: 1,
    });
    assert.equal((await adapter.getResult(handle)).exitCode, 0);
    const requests = (await readFile(runtime.requestLog, "utf8"))
      .trim().split("\n").map((request) => JSON.parse(request) as Record<string, unknown>);
    assert.equal(requests.some((request) => request.method === "session/setModel"), false);
    assert.ok(events.some((event) => event.type === "model_selected" && event.details?.["model_id"] === "model-x"));
  } finally {
    await rm(runtime.root, { recursive: true, force: true });
  }
});

test("cancels a pending permission with one verified runtime cleanup", { timeout: 5_000 }, async () => {
  const runtime = await makeFakeRuntime(undefined, true, true);
  let ready!: () => void;
  const interactionReady = new Promise<void>((resolve) => { ready = resolve; });
  let runtimePid: number | undefined;
  try {
    const adapter = new ZCodeAppServerAdapter({
      resolver: { resolve: async () => runtime.config },
      onEvent: (event) => {
        if (event.type === "app_server_started") runtimePid = event.details?.["pid"] as number;
      },
      resolveInteraction: async (_request, signal) => {
        ready();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        return { decision: "deny" };
      },
      timeoutMs: 3_000,
      childEnvBase: { PATH: process.env.PATH },
    });
    const handle = await adapter.startTask({ task, workspace: makeWorkspace(runtime.root), attempt: 1 });
    const result = assert.rejects(adapter.getResult(handle), (error: unknown) => error instanceof BridgeError && error.code === "cancelled");
    await interactionReady;
    await Promise.all([adapter.cancelTask(handle), adapter.cancelTask(handle)]);
    await result;
    assert.ok(runtimePid);
    assert.equal(isProcessRunning(runtimePid), false);
  } finally { await rm(runtime.root, { recursive: true, force: true }); }
});

test("forwards a permission decision to ZCode and resolves duplicate request IDs once", async () => {
  const runtime = await makeFakeRuntime(undefined, true, true);
  const events: Array<{ type: string; summary: string; details?: Record<string, unknown> }> = [];
  const requests: Array<{ request_id: string; method: string }> = [];
  try {
    const adapter = new ZCodeAppServerAdapter({
      resolver: { resolve: async () => runtime.config },
      onEvent: (event) => events.push(event),
      resolveInteraction: async (request) => {
        requests.push({ request_id: request.request_id, method: request.method });
        return { decision: "deny", reason: "Not authorized" };
      },
      timeoutMs: 10_000,
      childEnvBase: { PATH: process.env.PATH },
    });
    const handle = await adapter.startTask({ task, workspace: makeWorkspace(runtime.root), attempt: 1 });
    assert.equal((await adapter.getResult(handle)).exitCode, 0);
    assert.deepEqual(requests, [{ request_id: "permission-1", method: "interaction/requestPermission" }]);
    assert.equal(events.filter((event) => event.type === "interaction_replied").length, 1);
    const messages = (await readFile(runtime.requestLog, "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    const replies = messages.filter((message) => message.id === "interaction-rpc-1" || message.id === "interaction-rpc-2");
    assert.deepEqual(replies, [
      { id: "interaction-rpc-1", result: { decision: "deny", reason: "Not authorized" } },
      { id: "interaction-rpc-2", result: { decision: "deny", reason: "Not authorized" } },
    ]);
  } finally {
    await rm(runtime.root, { recursive: true, force: true });
  }
});

test("ZCode sends ordered native image attachments and only new images on same-session continuation", async () => {
  const runtime = await makeFakeRuntime();
  const events: unknown[] = [];
  try {
    const images = ["首张图.png", "next.png"];
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    for (const image of images) await writeFile(path.join(runtime.root, image), png);
    const adapter = new ZCodeAppServerAdapter({ resolver: { resolve: async () => runtime.config }, onEvent: e => events.push(e), timeoutMs: 10_000, childEnvBase: { PATH: process.env.PATH } });
    const withImages = { ...task, attachments: images.map(image => ({ path: path.join(runtime.root, image) })) };
    const first = await adapter.getResult(await adapter.startTask({ task: withImages, workspace: makeWorkspace(runtime.root), attempt: 1 }));
    const continued = await adapter.getResult(await adapter.continueTask({ task: withImages, workspace: makeWorkspace(runtime.root), attempt: 2, feedback: "inspect new image", additionalRequirements: [], previousSessionId: first.sessionId, previousResult: null, attachments: [withImages.attachments[1]!] }));
    await adapter.getResult(await adapter.continueTask({ task: withImages, workspace: makeWorkspace(runtime.root), attempt: 3, feedback: "remember", additionalRequirements: [], previousSessionId: continued.sessionId, previousResult: null }));
    const requests = (await readFile(runtime.requestLog, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const sends = requests.filter(r => r.method === "session/send");
    assert.deepEqual(sends[0].params.attachments.map((image: { filename: string; kind: string; mimeType: string; sizeBytes: number }) => [image.filename, image.kind, image.mimeType, image.sizeBytes]), images.map(name => [name, "image", "image/png", png.length]));
    assert.deepEqual(sends[0].params.attachments.map((image: { localPath: string }) => image.localPath), withImages.attachments.map(image => image.path));
    assert.equal(sends[1].params.attachments.length, 1);
    assert.equal(sends[1].params.attachments[0].filename, "next.png");
    assert.equal(sends[2].params.attachments, undefined);
    assert.equal(requests.filter(r => r.method === "session/create").length, 1);
    assert.equal(requests.filter(r => r.method === "session/resume").length, 2);
    assert.doesNotMatch(JSON.stringify(events), /dataBase64|iVBORw0KGgo/);
  } finally { await rm(runtime.root, { recursive: true, force: true }); }
});

test("a deleted ZCode image fails explicitly before starting the runtime", async () => {
  const events: unknown[] = [];
  const adapter = new ZCodeAppServerAdapter({ resolver: { resolve: async () => { throw new Error("must not resolve runtime"); } }, onEvent: e => events.push(e) });
  const handle = await adapter.startTask({ task: { ...task, attachments: [{ path: path.join(tmpdir(), "bridge-image-missing-file.png") }] }, workspace: makeWorkspace(tmpdir()), attempt: 1 });
  await assert.rejects(adapter.getResult(handle), { code: "attachment_invalid" });
  assert.equal(events.some(e => (e as { type: string }).type === "app_server_started"), false);
});


test("raw native data is returned without report claims, including same-session continuation", async () => {
  const response = '[{"label":true},{"label":false}]';
  const runtime = await makeFakeRuntime(undefined, true, false, undefined, "event", { response });
  const events: { type: string }[] = [];
  let firstCheckpointBeforeUsage: boolean | undefined;
  try {
    const adapter = new ZCodeAppServerAdapter({ resolver: { resolve: async () => runtime.config }, onEvent: e => events.push(e), onOutcomeCheckpoint: () => { firstCheckpointBeforeUsage ??= !readFileSync(runtime.requestLog, "utf8").includes('"method":"session/usage"'); }, childEnvBase: { PATH: process.env.PATH } });
    const rawTask = { ...task, report_mode: "raw" as const, session_profile: "minimal" as const };
    const input = { task: rawTask, workspace: makeWorkspace(runtime.root), attempt: 1 };
    const result = await adapter.getResult(await adapter.startTask(input));
    assert.equal(result.response, response); assert.equal(result.errorCode, null); assert.equal(result.agentReport, null);
    assert.equal(result.cleanupVerified, true); assert.equal(result.runtimeSessionUsage?.model_request_count, 7);
    assert.equal(firstCheckpointBeforeUsage, true, "completed work is durable before a supplementary usage RPC can hang or fail");
    assert.equal(events.some(e => e.type === "report_ready"), false, "data is not an AgentReport or acceptance verdict");
    const next = await adapter.getResult(await adapter.continueTask({ ...input, attempt: 2, feedback: "Return updated data", additionalRequirements: [], previousSessionId: result.sessionId, previousResult: null }));
    assert.equal(next.response, response); assert.equal(next.sessionId, result.sessionId);
    const requests = (await readFile(runtime.requestLog, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const create = requests.find(r => r.method === "session/create").params;
    const resume = requests.find(r => r.method === "session/resume").params;
    for (const params of [create, resume]) {
      assert.deepEqual(params.toolAllowlist, []); assert.deepEqual(params.mcpServers, []);
      assert.equal(params.dynamicWorkflowEnabled, false); assert.equal(params.offPeakToolEnabled, false);
    }
    assert.equal(create.titleGenerationEnabled, false); assert.equal(resume.titleGenerationEnabled, undefined);
    for (const send of requests.filter(r => r.method === "session/send")) {
      assert.doesNotMatch(send.params.content, /OUTPUT CONTRACT \(mandatory\)|Required fields: summary|DECISION RULE/);
      assert.match(send.params.content, /RAW OUTPUT/);
    }
    assert.doesNotMatch(JSON.stringify(result), /HIDDEN_USAGE/);
  } finally { await rm(runtime.root, { recursive: true, force: true }); }
});

test("raw mode cannot convert an unknown or failed native terminal into success", async () => {
  for (const resultType of [null, "error"]) {
    const runtime = await makeFakeRuntime(undefined, true, false, undefined, "event", { response: "[]", resultType });
    try {
      const adapter = new ZCodeAppServerAdapter({ resolver: { resolve: async () => runtime.config }, childEnvBase: { PATH: process.env.PATH } });
      const outcome = await adapter.getResult(await adapter.startTask({ task: { ...task, report_mode: "raw" }, workspace: makeWorkspace(runtime.root), attempt: 1 }));
      assert.ok(outcome.errorCode); assert.equal(outcome.response, "[]");
    } finally { await rm(runtime.root, { recursive: true, force: true }); }
  }
});

test("content safety rejection survives native event and RPC wrappers without private error text", async () => {
  for (const delivery of ["event", "rpc"] as const) {
    const runtime = await makeFakeRuntime(undefined, true, false, { code: "UNKNOWN_ERROR", message: "Turn failed", underlyingErrorMessage: "[1301][unsafe][PRIVATE_REQUEST_ID]", data: { error: { message: "[1301][系统检测到输入或生成内容可能包含不安全或敏感内容][PRIVATE_REQUEST_ID]", retryable: false }, headers: { Authorization: "SECRET" }, url: "https://private.invalid/SECRET" } }, delivery);
    const events: unknown[] = [];
    try {
      const adapter = new ZCodeAppServerAdapter({ resolver: { resolve: async () => runtime.config }, onEvent: e => events.push(e), childEnvBase: { PATH: process.env.PATH } });
      await assert.rejects(adapter.getResult(await adapter.startTask({ task, workspace: makeWorkspace(runtime.root), attempt: 1 })), error => {
        assert.match(String(error), /content safety rejection \(1301\)/); assert.doesNotMatch(String(error), /PRIVATE|SECRET|private.invalid/);
        assert.ok(error instanceof BridgeError); assert.equal(error.providerError?.code, "1301");
        assert.equal(error.providerError?.retryable, false, "event and RPC failures must both carry machine-readable evidence to the worker");
        return true;
      });
      assert.doesNotMatch(JSON.stringify(events), /PRIVATE|SECRET|private.invalid/);
    } finally { await rm(runtime.root, { recursive: true, force: true }); }
  }
});


test("raw native capture overflow is explicit instead of silently returning incomplete data", async () => {
  const runtime = await makeFakeRuntime(undefined, true, false, undefined, "event", { response: "x".repeat(2_000_001) });
  try {
    const rawTask = { ...task, report_mode: "raw" as const };
    const adapter = new ZCodeAppServerAdapter({ resolver: { resolve: async () => runtime.config }, childEnvBase: { PATH: process.env.PATH } });
    const outcome = await adapter.getResult(await adapter.startTask({ task: rawTask, workspace: makeWorkspace(runtime.root), attempt: 1 }));
    assert.equal(outcome.stdoutTruncated, true); assert.equal(outcome.response?.length, 2_000_000);
    const result = buildTaskResult({ task: rawTask, attempt: 1, startedAt: null, finishedAt: new Date().toISOString(), outcome });
    assert.equal(result.status, "failed"); assert.equal(result.error_code, "output_truncated");
    assert.equal(result.zcode_output.length, 2_000_000);
  } finally { await rm(runtime.root, { recursive: true, force: true }); }
});
