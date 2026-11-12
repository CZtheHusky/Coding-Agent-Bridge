// Public diagnostic projection: retain bounded, redacted error text, never
// whole provider objects, headers, request bodies or private metadata.
import { stripVTControlCharacters } from "node:util";
import type { ProviderError } from "../interfaces.js";

/** Shared by provider messages and startup stderr; redact before truncating. */
export function sanitizeDiagnosticText(value: string): string {
  const text = stripVTControlCharacters(value)
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/gu, "")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/gu, "[REDACTED PRIVATE KEY]")
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"')\]]+/giu, "[REDACTED URL]")
    .replace(/(\b(?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n]+)/giu, "$1[REDACTED]")
    .replace(/(["']?\b(?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|password|passwd|token|secret)\b["']?\s*[:=]\s*)(?:\[REDACTED\]|"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/giu, "$1[REDACTED]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu, "$1 [REDACTED]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/gu, "[REDACTED TOKEN]")
    .trim();
  const marker = "…[truncated]";
  return text.length <= 4_000 ? text : text.slice(0, 4_000 - marker.length) + marker;
}

export function providerFailureDiagnostic(value: unknown): { summary: string; details: ProviderError } {
  const details: ProviderError = {};
  const messages: string[] = [];
  const rememberMessage = (value: unknown): void => {
    if (typeof value !== "string" || messages.join("\n").length >= 4_000) return;
    const text = sanitizeDiagnosticText(value);
    if (text && !messages.includes(text)) messages.push(text);
  };
  let contentFilter = false;
  let code1301 = false;
  const visit = (value: unknown, depth: number): void => {
    if (typeof value === "string") {
      rememberMessage(value);
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
      rememberMessage(item);
      if (typeof item === "string" && /\[1301\]|系统检测到输入或生成内容可能包含不安全或敏感内容/u.test(item.slice(0, 16_384))) contentFilter = true;
      if (typeof item === "string" && /\[1301\]/u.test(item.slice(0, 16_384))) code1301 = true;
    }
    for (const key of ["error", "cause", "data", "detail", "attribution"]) visit(record[key], depth + 1);
  };
  visit(value, 0);
  if (messages.length) details.message = sanitizeDiagnosticText(messages.join("\n"));
  if (contentFilter) {
    if (code1301) details.code = "1301";
    details.category = "content_filter";
    return { summary: `ZCode turn failed: provider content safety rejection${code1301 ? " (1301)" : ""}; do not retry unchanged input automatically`, details };
  }
  const { message, ...fields } = details;
  const suffix = Object.keys(fields).length ? ` (${JSON.stringify(fields)})` : "";
  return { summary: `ZCode turn failed${message ? `: ${message}` : ""}${suffix}`, details };
}
