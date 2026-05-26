# Coding Guidelines

> 所有 Agent 在写代码前必须先阅读此文件。

## 1. Secrets & API Keys

- **No plaintext API keys on disk**: Always encrypt when persisting. Use `crypto` AES-256-GCM in bridge, env-var-derived keys.
- **No API keys in URL query strings**: Use `Authorization` header, `X-Api-Key` header, or POST body. Keys in URLs leak to server logs, proxies, browser history.
- **No hardcoded URLs**: Bridge URL must be configurable via env var (e.g. `VITE_BRIDGE_URL`), never hardcoded `localhost:3001`.
- **Mask before logging**: Use `logger.maskKey()` to redact API keys in all log output.

## 2. Route & Deployment Safety

- **Test/dev routes must never reach production**: Guard test-only endpoints with `if (process.env.NODE_ENV === 'development')`. Never mount test routes unconditionally.
- **File paths must be sanitized**: Any user-controlled input used in file paths must strip `..`, `/`, `\`, and non-alphanumeric characters with `sanitizeSessionId()` or equivalent.
- **Use `NODE_ENV` consistently**: Production, development, and test environments must be explicitly differentiated.

## 3. State Management

- **No module-level mutable globals for per-request state**: Shared variables like `let searchAgent` cause cross-request races. Create fresh instances per request or use a pool.
- **No `console.log` in production code**: Use the project logger (`bridge/src/logger.js`) for bridge, or structured logging for frontend. Remove debug logging before committing.

## 4. Code Cleanliness

- **No dead code**: Functions that always throw errors, deprecated components, unused types must be removed, not left as "backward compat" stubs.
- **No duplicated type definitions**: Keep interfaces in `types/` only, don't duplicate in `db/` schema files.
- **No deprecated code paths**: When migrating to a new architecture (e.g. direct-LLM → bridge), remove the old code, don't leave it with `throw new Error('please use X')`.

## 5. Database & Storage

- **Don't store secrets in IndexedDB** unless strictly necessary; prefer global config in localStorage.
- **Use encryption for any persisted credentials**, even in local development.

## 6. Error Handling

- **Every error path must be logged**: If a catch block silently swallows an error (`catch { /* ignore */ }`), there must be a logged justification.
- **API responses must be sanitized**: Don't echo raw error messages that might contain sensitive data.
