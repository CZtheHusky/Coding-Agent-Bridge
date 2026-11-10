import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createBridgeInfoProbe } from "../src/runtime/bridge-info.js";

test("a running core detects same-version code replacement, not timestamp-only or documentation changes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bridge-build-"));
  try {
    mkdirSync(path.join(root, "runtime"));
    const file = path.join(root, "runtime", "bridge-info.js");
    writeFileSync(file, "original");
    const probe = createBridgeInfoProbe("1.2.7", pathToFileURL(file).href);
    const initial = probe();
    assert.equal(initial.disk_status, "same");
    assert.equal(initial.reconnect_required, false);
    utimesSync(file, new Date(0), new Date(0));
    writeFileSync(path.join(root, "README.md"), "updated instructions");
    assert.equal(probe().disk_status, "same", "reconnect is needed for execution changes, not a touched file or docs");
    writeFileSync(file, "new code");
    const changed = probe();
    assert.equal(changed.version, initial.version);
    assert.equal(changed.running_build_id, initial.running_build_id);
    assert.equal(changed.disk_status, "changed");
    assert.equal(changed.reconnect_required, true);
    const restarted = createBridgeInfoProbe("1.2.7", pathToFileURL(file).href)();
    assert.equal(restarted.disk_status, "same");
    assert.equal(restarted.running_build_id, changed.disk_build_id);
    assert.equal(createBridgeInfoProbe("1.2.7", pathToFileURL(path.join(root, "custom-host.js")).href)().disk_status, "unknown", "custom bundles must not cause a scan of the parent project or dependency tree");
    assert.doesNotMatch(JSON.stringify(changed), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("plugin identity includes worker and scheduler replacements and never calls a missing distribution current", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bridge-build-"));
  try {
    mkdirSync(path.join(root, "dist")); mkdirSync(path.join(root, "worker"));
    for (const f of ["dist/bridge.mjs", "worker/worker-main.mjs", "worker/schedule-runner.mjs"]) writeFileSync(path.join(root, f), f);
    const moduleUrl = pathToFileURL(path.join(root, "dist", "bridge.mjs")).href;
    const probe = createBridgeInfoProbe("1.2.7", moduleUrl);
    assert.equal(probe().disk_status, "same");
    writeFileSync(path.join(root, "worker", "worker-main.mjs"), "new worker");
    assert.equal(probe().disk_status, "changed", "a worker-only fix also requires the host to refresh its installation");
    rmSync(path.join(root, "worker", "schedule-runner.mjs"));
    assert.equal(probe().disk_status, "unknown"); assert.equal(probe().reconnect_required, null);
    const missingBaseline = createBridgeInfoProbe("1.2.7", moduleUrl);
    writeFileSync(path.join(root, "worker", "schedule-runner.mjs"), "restored");
    assert.equal(missingBaseline().disk_status, "unknown", "a baseline that could not be read cannot prove the running files match");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
