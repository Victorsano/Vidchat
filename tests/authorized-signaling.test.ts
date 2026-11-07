import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { embedded } from "../lib/backend/db";
import { DorcasService, type Actor } from "../lib/backend/service";
import { RoomService } from "../lib/backend/rooms";
import { hash, token } from "../lib/backend/security";
import { attachSignaling } from "../signaling";
test("authenticated WebSockets reject outsiders and isolate rooms, revocation and kicks", async () => {
  const db = await embedded(),
    core = new DorcasService(db),
    rooms = new RoomService(core);
  const users: { a: Actor; raw: string }[] = [];
  for (let n = 0; n < 4; n++) {
    const id = randomUUID(),
      session = randomUUID(),
      raw = token();
    await db.query(
      `INSERT INTO users(id,email,verified_at,status,birth_date_private,age_reviewed_at) VALUES($1,$2,now(),'active','2000-01-01',now())`,
      [id, `rtc${n}@student.babcock.edu.ng`],
    );
    await db.query(
      `INSERT INTO profiles(user_id,display_name,bio,interests,modes,paused,review_status) VALUES($1,'Test peer','Fictional integration test',ARRAY['Music','Reading','Design'],ARRAY['friends'],false,'approved')`,
      [id],
    );
    await db.query(
      `INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')`,
      [session, id, hash(raw)],
    );
    users.push({ a: await core.actor(raw), raw });
  }
  const one = await rooms.create(users[0].a, "Room one", "friends", 2),
    two = await rooms.create(users[2].a, "Room two", "friends", 2);
  const server = createServer();
  const wss = attachSignaling(server, {
    authenticate: (req) => core.actor(req.headers.cookie?.split("=")[1]),
    claim: (a, t, id) => rooms.claim(a, t, id),
    refresh: (a, r, id) => rooms.refresh(a, r, id),
    release: (id) => rooms.release(id),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const clients: WebSocket[] = [];
  const next = (ws: WebSocket) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("WebSocket response timeout")),
        3000,
      );
      ws.once("message", (m) => {
        clearTimeout(timer);
        resolve(JSON.parse(m.toString()));
      });
    });
  async function connect(user: (typeof users)[number], room: string) {
    const ticket = await rooms.ticket(user.a, room);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/signal`, {
      headers: {
        Origin: `http://127.0.0.1:${port}`,
        Cookie: `dorcas_session=${user.raw}`,
      },
    });
    clients.push(ws);
    await new Promise((r) => ws.once("open", r));
    const response = next(ws);
    ws.send(
      JSON.stringify({
        type: "join",
        ticket: ticket.ticket,
        mic: false,
        camera: false,
      }),
    );
    return { ws, w: await response };
  }
  try {
    const rejected = new WebSocket(`ws://127.0.0.1:${port}/signal`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    await new Promise<void>((resolve, reject) => {
      rejected.once("unexpected-response", (_, r) => {
        assert.equal(r.statusCode, 403);
        r.resume();
        resolve();
      });
      rejected.once("open", () => reject(new Error("Visitor was admitted")));
      rejected.on("error", () => {});
    });
    const a = await connect(users[0], one.id),
      b = await connect(users[1], one.id),
      c = await connect(users[2], two.id);
    assert.equal(a.w.peers.length, 0);
    assert.equal(b.w.peers.length, 1);
    assert.equal(c.w.peers.length, 0);
    assert.equal(b.w.peers[0].mic, false);
    const seen: any[] = [];
    c.ws.on("message", (m) => seen.push(JSON.parse(m.toString())));
    a.ws.send(
      JSON.stringify({
        type: "signal",
        to: c.w.id,
        data: { description: { type: "offer", sdp: "must not cross rooms" } },
      }),
    );
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(seen.length, 0);
    const received = next(b.ws);
    a.ws.send(
      JSON.stringify({
        type: "signal",
        to: b.w.id,
        data: { description: { type: "offer", sdp: "same room" } },
      }),
    );
    assert.equal((await received).from, a.w.id);
    const closed = new Promise((r) => b.ws.once("close", r));
    await rooms.kick(users[0].a, one.id, users[1].a.id);
    await wss.reconcile();
    await closed;
    await assert.rejects(rooms.ticket(users[1].a, one.id));
    const revoked = new Promise((r) => c.ws.once("close", r));
    await core.logout(users[2].a, true);
    await wss.reconcile();
    await revoked;
  } finally {
    clients.forEach((c) => c.terminate());
    await new Promise<void>((r) => wss.close(() => r()));
    await new Promise<void>((r) => server.close(() => r()));
    await db.close();
  }
});
