import test from "node:test";
import assert from "node:assert/strict";
import { validTotp } from "../lib/backend/security";

test("moderator TOTP matches published SHA-1 vectors and rejects stale or malformed codes", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert(validTotp(secret, "287082", 59_000));
  assert(validTotp(secret, "081804", 1_111_111_109_000));
  assert(!validTotp(secret, "287082", 180_000));
  assert(!validTotp("invalid!", "287082", 59_000));
  assert(!validTotp(secret, "0287082", 59_000));
});
