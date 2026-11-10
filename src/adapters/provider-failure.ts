// Public diagnostic projection. Never copy arbitrary messages, headers, URLs,
// request bodies or provider metadata. Recognized message markers become our
// own text; unknown text remains private to the native runtime.
import type { ProviderError } from "../interfaces.js";

export function providerFailureDiagnostic(value: unknown): { summary: string; details: ProviderError } {
  const details: ProviderError = {};
  let contentFilter = false;
  let code1301 = false;
  const visit = (value: unknown, depth: number): void => {
    if (typeof value === "string") {
      if (/\[1301\]/u.test(value.slice(0, 16_384))) { contentFilter = true; code1301 = true; }
      return;
    }
    if (depth > 4 || !value || typeof value !== "object" || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    if (record.category === "content_filter") contentFilter = true;
    for (const key of ["code", "errorCode", "error_code", "providerErrorCode", "type"]) {
      const item = record[key];
      const text = typeof item === "string" ? item : typeof item === "number" && Number.isFinite(item) ? String(item) : "";
      if (/^(?:\d{3,6}|UNKNOWN_ERROR|MODEL_RATE_LIMITED|rate_limit_exceeded|content_filter|content_policy_violation)$/u.test(text)) {
        details[key === "type" ? "type" : "code"] = text;
        if (text === "1301" || text === "content_filter" || text === "content_policy_violation") contentFilter = true;
        if (text === "1301") code1301 = true;
      }
    }
    for (const key of ["status", "statusCode", "retryAfter", "retry_after"] as const) {
      const item = record[key];
      if (typeof item === "number" && Number.isFinite(item) && item >= 0) details[key] = item;
    }
    if (typeof record.retryable === "boolean") details.retryable = record.retryable;
    for (const key of ["message", "detail", "reason", "errorMessage", "underlyingErrorMessage", "underlyingErrorDetail"]) {
      const item = record[key];
      if (typeof item === "string" && /\[1301\]|系统检测到输入或生成内容可能包含不安全或敏感内容/u.test(item.slice(0, 16_384))) contentFilter = true;
      if (typeof item === "string" && /\[1301\]/u.test(item.slice(0, 16_384))) code1301 = true;
    }
    for (const key of ["error", "cause", "data", "detail", "attribution"]) visit(record[key], depth + 1);
  };
  visit(value, 0);
  if (contentFilter) {
    if (code1301) details.code = "1301";
    details.category = "content_filter";
    return { summary: `ZCode turn failed: provider content safety rejection${code1301 ? " (1301)" : ""}; do not retry unchanged input automatically`, details };
  }
  const suffix = Object.keys(details).length ? ` (${JSON.stringify(details)})` : "";
  return { summary: `ZCode turn failed${suffix}`, details };
}
