import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { embedded, type Database } from "../lib/backend/db";
import { DorcasService, type Actor } from "../lib/backend/service";
import { RoomService } from "../lib/backend/rooms";
import { adult, eligibleEmail, ApiError, hash } from "../lib/backend/security";
let db: Database, core: DorcasService, rooms: RoomService, admin: Actor;
const codes = new Map<string, string>();
let counter = 0;
before(async () => {
  process.env.ADMIN_EMAILS = "moderator@example.invalid";
  db = await embedded();
  core = new DorcasService(db, async (email, code) => {
    codes.set(email, code);
  });
  rooms = new RoomService(core);
  await core.start("moderator@example.invalid", "admin");
  const s = await core.verify(
    "moderator@example.invalid",
    codes.get("moderator@example.invalid")!,
  );
  admin = await core.actor(s.token);
});
after(async () => {
  await db?.close();
});
async function student(active = true) {
  const email = `student${++counter}@student.babcock.edu.ng`;
  await core.start(email, email);
  const s = await core.verify(email, codes.get(email)!);
  let a = await core.actor(s.token, false);
  await core.profile(a, {
    display_name: "Test Student",
    bio: "A fictional test profile.",
    interests: ["Music", "Reading", "Design"],
    modes: ["friends", "dating", "study"],
    paused: false,
    birthDate: "2000-01-01",
    termsAccepted: true,
  });
  if (active) {
    await core.review(
      admin,
      a.id,
      "approve",
      "Independent test eligibility review completed.",
    );
    a = await core.actor(s.token);
    await db.query(
      `INSERT INTO profile_photos(id,user_id,object_key,status) VALUES($1,$2,$3,'approved')`,
      [randomUUID(), a.id, `test/${a.id}`],
    );
  }
  return { a, raw: s.token, email };
}
const denied = (promise: Promise<unknown>, code?: string) =>
  assert.rejects(
    promise,
    (e: unknown) => e instanceof ApiError && (!code || e.code === code),
  );
test("email boundary, exact age and hashed OTP/session handling", async () => {
  assert(eligibleEmail("Person@STUDENT.BABCOCK.EDU.NG"));
  assert(!eligibleEmail("x@student.babcock.edu.ng.attacker.test"));
  assert(!eligibleEmail("x@babcock.edu.ng"));
  assert(!adult("2020-01-01"));
  assert(!adult("2000-02-30"));
  assert(adult("2000-01-01"));
  const email = "otp@student.babcock.edu.ng";
  await core.start(email, "otp");
  const stored = (
    await db.query("SELECT * FROM email_challenges WHERE email=$1", [email])
  ).rows[0];
  assert.notEqual(stored.code_hash, codes.get(email));
  for (let i = 0; i < 5; i++)
    await denied(core.verify(email, "not-the-code"), "INVALID_CODE");
  await denied(core.verify(email, codes.get(email)!), "INVALID_CODE");
  const s = await student();
  const session = (
    await db.query("SELECT token_hash FROM sessions WHERE user_id=$1", [s.a.id])
  ).rows[0];
  assert.equal(session.token_hash, hash(s.raw));
  await denied(core.verify(s.email, codes.get(s.email)!), "INVALID_CODE");
});
test("onboarding and age review cannot be bypassed with a profile submission", async () => {
  const s = await student(false);
  await denied(core.actor(s.raw), "ONBOARDING");
  await denied(
    core.profile(s.a, { birthDate: "2020-01-01", termsAccepted: true }),
    "ADULT_REQUIRED",
  );
  assert.equal((await core.actor(s.raw, false)).status, "review");
  await denied(
    core.review(s.a, s.a.id, "approve", "Please activate me."),
    "ROLE",
  );
});
test("one-sided likes cannot message; reciprocal likes deduplicate under retries", async () => {
  const x = await student(),
    y = await student(),
    stranger = await student();
  assert.deepEqual(await core.swipe(x.a, y.a.id, "friends", "like"), {
    matched: false,
  });
  assert.equal((await core.conversations(x.a)).length, 0);
  const match = await core.swipe(y.a, x.a.id, "friends", "like");
  assert(match.matched);
  const retry = await core.swipe(y.a, x.a.id, "friends", "like");
  assert.equal(retry.conversationId, match.conversationId);
  assert.equal(
    (
      await db.query("SELECT * FROM matches WHERE low_id=$1 AND high_id=$2", [
        [x.a.id, y.a.id].sort()[0],
        [x.a.id, y.a.id].sort()[1],
      ])
    ).rowCount,
    1,
  );
  await denied(core.messages(stranger.a, match.conversationId!), "NOT_FOUND");
  const nonce = randomUUID();
  const first = await core.message(x.a, match.conversationId!, "Hello!", nonce),
    second = await core.message(x.a, match.conversationId!, "A retry", nonce);
  assert.equal(first.id, second.id);
  assert.equal(second.body, "Hello!");
  assert.equal((await core.messages(y.a, match.conversationId!)).length, 1);
});
test("blocks and account revocation suppress discovery, chat and ticket access", async () => {
  const x = await student(),
    y = await student();
  await core.swipe(x.a, y.a.id, "study", "like");
  const match = await core.swipe(y.a, x.a.id, "study", "like");
  await core.block(x.a, y.a.id);
  assert.equal(await core.eligible(x.a.id, y.a.id, "study"), false);
  await denied(
    core.message(y.a, match.conversationId!, "Unwanted", randomUUID()),
    "NOT_FOUND",
  );
  await denied(core.swipe(y.a, x.a.id, "study", "like"), "NOT_FOUND");
  await core.logout(x.a, true);
  await denied(core.actor(x.raw), "SESSION");
});
test("quick matching requires both accepts and returns private membership only afterward", async () => {
  const x = await student(),
    y = await student();
  assert.equal((await rooms.enqueue(x.a, "dating")).state, "queued");
  assert.equal((await rooms.enqueue(y.a, "dating")).state, "proposed");
  const proposal = await rooms.queueStatus(x.a);
  assert.equal(proposal.state, "proposed");
  assert.equal(proposal.roomId, undefined);
  assert.equal((await rooms.respond(x.a, proposal.id!, true)).state, "waiting");
  const ready = await rooms.respond(y.a, proposal.id!, true);
  assert.equal(ready.state, "ready");
  assert(ready.roomId);
  const stranger = await student();
  await denied(rooms.ticket(stranger.a, ready.roomId!), "ROOM");
  assert((await rooms.ticket(x.a, ready.roomId!)).ticket);
});
test("room tickets are single-use, capacity is atomic, cross-room members stay isolated", async () => {
  const owner = await student(),
    x = await student(),
    y = await student();
  const r = await rooms.create(owner.a, "Test room", "study", 2);
  const t1 = await rooms.ticket(owner.a, r.id),
    t2 = await rooms.ticket(x.a, r.id),
    t3 = await rooms.ticket(y.a, r.id);
  const c1 = randomUUID(),
    c2 = randomUUID();
  assert.equal((await rooms.claim(owner.a, t1.ticket, c1)).roomId, r.id);
  await denied(rooms.claim(owner.a, t1.ticket, randomUUID()), "TICKET");
  await rooms.claim(x.a, t2.ticket, c2);
  await denied(rooms.claim(y.a, t3.ticket, randomUUID()), "FULL");
  await rooms.release(c1);
  assert((await rooms.claim(y.a, t3.ticket, randomUUID())).roomId);
  await core.block(owner.a, x.a.id);
  assert.equal(await rooms.refresh(owner.a, r.id, c1), false);
});
test("call invitations are recipient-only and require an open conversation", async () => {
  const x = await student(),
    y = await student(),
    z = await student();
  await core.swipe(x.a, y.a.id, "friends", "like");
  const match = await core.swipe(y.a, x.a.id, "friends", "like");
  const invite = await rooms.invite(x.a, match.conversationId!);
  await denied(rooms.respondInvite(z.a, invite.id, true), "INVITATION");
  const accepted = await rooms.respondInvite(y.a, invite.id, true);
  assert(accepted.roomId);
  await core.unmatch(x.a, match.conversationId!);
  await denied(rooms.ticket(y.a, accepted.roomId!), "ROOM");
});
test("public profiles omit private identity, deletion revokes access and scrubs profile", async () => {
  const x = await student(),
    y = await student();
  const p = await core.safeProfile(x.a.id);
  assert(!("email" in p));
  assert(!("birth_date_private" in p));
  assert(!("age" in p) || p.age === undefined);
  await core.deleteAccount(x.a);
  await denied(core.actor(x.raw), "SESSION");
  assert.equal(await core.eligible(y.a.id, x.a.id, "friends"), false);
  assert.equal(
    (
      await db.query(
        "SELECT status,birth_date_private FROM users WHERE id=$1",
        [x.a.id],
      )
    ).rows[0].birth_date_private,
    null,
  );
});
