import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BridgeRuntimeInfo } from "../interfaces.js";

/** Observe same-version replacements without changing execution or restarting workers. */
export function createBridgeInfoProbe(version: string, moduleUrl = import.meta.url): () => BridgeRuntimeInfo {
  const modulePath = fileURLToPath(moduleUrl);
  const bundled = modulePath.endsWith(".mjs");
  const root = path.resolve(path.dirname(modulePath), "..");
  const fingerprint = (): string | null => {
    try {
      const files: string[] = [];
      if (bundled) files.push("dist/bridge.mjs", "worker/worker-main.mjs", "worker/schedule-runner.mjs");
      else {
        if (path.basename(modulePath) !== "bridge-info.js" || path.basename(path.dirname(modulePath)) !== "runtime") return null;
        const visit = (directory: string): void => {
          for (const item of readdirSync(path.join(root, directory), { withFileTypes: true })) {
            const relative = path.join(directory, item.name);
            if (item.isDirectory()) visit(relative);
            else if (item.isFile() && /\.(?:c?js)$/u.test(item.name)) files.push(relative);
          }
        };
        visit("");
      }
      if (!files.some(file => path.normalize(file) === path.relative(root, modulePath))) return null;
      const hash = createHash("sha256");
      for (const file of files.sort()) hash.update(file.replaceAll("\\", "/") + "\0").update(readFileSync(path.join(root, file))).update("\0");
      return hash.digest("hex");
    } catch { return null; }
  };
  const startedAt = new Date().toISOString();
  const runningBuildId = fingerprint();
  return () => {
    const diskBuildId = fingerprint();
    const diskStatus = runningBuildId === null || diskBuildId === null ? "unknown" : runningBuildId === diskBuildId ? "same" : "changed";
    return {
      version, started_at: startedAt, running_build_id: runningBuildId, disk_build_id: diskBuildId,
      disk_status: diskStatus, reconnect_required: diskStatus === "unknown" ? null : diskStatus === "changed",
    };
  };
}
