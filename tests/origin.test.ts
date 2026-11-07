import { test } from "node:test";
import assert from "node:assert/strict";
import { requireOrigin } from "../lib/backend/security";
test("origin checks accept the real browser host behind the internal listener and reject cross-site writes", () => {
  assert.doesNotThrow(() =>
    requireOrigin(
      new Request("http://0.0.0.0:3000/api/me", {
        method: "POST",
        headers: { host: "localhost:3000", origin: "http://localhost:3000" },
      }),
    ),
  );
  assert.throws(() =>
    requireOrigin(
      new Request("http://0.0.0.0:3000/api/me", {
        method: "POST",
        headers: { host: "localhost:3000", origin: "https://attacker.invalid" },
      }),
    ),
  );
  assert.throws(() =>
    requireOrigin(
      new Request("http://localhost:3000/api/me", { method: "POST" }),
    ),
  );
});
