import { createHmac, randomUUID } from "node:crypto";
import { DorcasService, type Actor, type Mode } from "./service";
import { fail, hash, token } from "./security";
export class RoomService {
  constructor(public core: DorcasService) {}
  async canEnter(a: Actor, id: string, db = this.core.db) {
    const r = await db.query(
      `SELECT * FROM rooms WHERE id=$1 AND status='open'`,
      [id],
    );
    const room = r.rows[0];
    if (
      (
        await db.query(
          "SELECT 1 FROM room_bans WHERE room_id=$1 AND user_id=$2",
          [id, a.id],
        )
      ).rowCount
    )
      fail(404, "ROOM", "Room unavailable.");
    if (!room) fail(404, "ROOM", "Room unavailable.");
    if (
      room.kind !== "public" &&
      !(
        await db.query(
          "SELECT 1 FROM room_members WHERE room_id=$1 AND user_id=$2",
          [id, a.id],
        )
      ).rowCount
    )
      fail(404, "ROOM", "Room unavailable.");
    const conflict = await db.query(
      `SELECT 1 FROM room_seats s JOIN blocks b ON (b.blocker_id=$2 AND b.blocked_id=s.user_id) OR (b.blocked_id=$2 AND b.blocker_id=s.user_id) WHERE s.room_id=$1 AND s.expires_at>now()`,
      [id, a.id],
    );
    const memberConflict = await db.query(
      `SELECT 1 FROM room_members m JOIN blocks b ON (b.blocker_id=$2 AND b.blocked_id=m.user_id) OR (b.blocked_id=$2 AND b.blocker_id=m.user_id) WHERE m.room_id=$1`,
      [id, a.id],
    );
    if (memberConflict.rowCount || conflict.rowCount)
      fail(404, "ROOM", "Room unavailable.");
    return room;
  }
  async list(a: Actor) {
    const rows = await this.core.db.query(
      `SELECT r.id,r.title,r.topic,r.kind,r.capacity,(SELECT count(*)::integer FROM room_seats s WHERE s.room_id=r.id AND s.expires_at>now()) count FROM rooms r WHERE r.status='open' AND (r.kind='public' OR EXISTS(SELECT 1 FROM room_members m WHERE m.room_id=r.id AND m.user_id=$1)) ORDER BY r.created_at LIMIT 40`,
      [a.id],
    );
    const result = [];
    for (const room of rows.rows) {
      try {
        const access = await this.canEnter(a, room.id);
        result.push({
          ...room,
          canModerate:
            access.host_id === a.id || ["admin", "moderator"].includes(a.role),
        });
      } catch {}
    }
    return result;
  }
  async create(a: Actor, title: string, topic: string, capacity: number) {
    await this.core.rate("create-room:" + a.id, 5, 3600);
    const id = randomUUID();
    await this.core.db.query(
      `INSERT INTO rooms(id,title,topic,kind,host_id,capacity) VALUES($1,$2,$3,'public',$4,$5)`,
      [id, title, topic, a.id, capacity],
    );
    return { id };
  }
  async ticket(a: Actor, id: string) {
    await this.core.rate("ticket:" + a.id, 30, 60);
    const room = await this.canEnter(a, id);
    const raw = token();
    await this.core.db.query(
      `INSERT INTO room_tickets(id,room_id,user_id,session_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '60 seconds')`,
      [randomUUID(), id, a.id, a.session_id, hash(raw)],
    );
    return {
      ticket: raw,
      expiresIn: 60,
      capacity: room.capacity,
      title: room.title,
      iceServers: this.ice(a.id),
      canModerate:
        room.host_id === a.id || ["admin", "moderator"].includes(a.role),
    };
  }
  ice(userId: string) {
    const servers: any[] = [
      {
        urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"],
      },
    ];
    const urls = (process.env.TURN_URLS || "").split(",").filter(Boolean);
    if (urls.length && process.env.TURN_SECRET) {
      const username = `${Math.floor(Date.now() / 1000) + 3600}:${userId}`;
      servers.push({
        urls,
        username,
        credential: createHmac("sha1", process.env.TURN_SECRET)
          .update(username)
          .digest("base64"),
      });
    }
    return servers;
  }
  async claim(a: Actor, raw: string, connectionId: string) {
    return this.core.db.transaction(async (db) => {
      const r = await db.query(
        `SELECT * FROM room_tickets WHERE token_hash=$1 AND user_id=$2 AND session_id=$3 AND expires_at>now() AND used_at IS NULL FOR UPDATE`,
        [hash(raw), a.id, a.session_id],
      );
      const t = r.rows[0];
      if (!t) fail(403, "TICKET", "Room ticket expired or already used.");
      await db.query("SELECT id FROM rooms WHERE id=$1 FOR UPDATE", [
        t.room_id,
      ]);
      await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [a.id]);
      const valid = await db.query(
        `SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active'`,
        [a.session_id, a.id],
      );
      if (!valid.rowCount) fail(401, "SESSION", "Session expired.");
      const room = await this.canEnter(a, t.room_id, db);
      await db.query("DELETE FROM room_seats WHERE expires_at<now()");
      if (
        (await db.query("SELECT 1 FROM room_seats WHERE user_id=$1", [a.id]))
          .rowCount
      )
        fail(
          409,
          "IN_CALL",
          "You are already in a room. Leave it before opening another.",
        );
      const count = (
        await db.query(
          "SELECT count(*)::integer n FROM room_seats WHERE room_id=$1",
          [room.id],
        )
      ).rows[0].n;
      if (count >= room.capacity) fail(409, "FULL", "The room is full.");
      await db.query(
        `INSERT INTO room_seats(room_id,user_id,connection_id,expires_at) VALUES($1,$2,$3,now()+interval '40 seconds')`,
        [room.id, a.id, connectionId],
      );
      await db.query("UPDATE room_tickets SET used_at=now() WHERE id=$1", [
        t.id,
      ]);
      return {
        roomId: room.id,
        userId: a.id,
        name:
          (
            await db.query(
              "SELECT display_name FROM profiles WHERE user_id=$1",
              [a.id],
            )
          ).rows[0]?.display_name || "Student",
      };
    });
  }
  async refresh(a: Actor, roomId: string, connectionId: string) {
    try {
      const valid = await this.core.db.query(
        `SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active'`,
        [a.session_id],
      );
      if (!valid.rowCount) return false;
      await this.canEnter(a, roomId);
      const r = await this.core.db.query(
        `UPDATE room_seats SET expires_at=now()+interval '40 seconds' WHERE connection_id=$1 AND expires_at>now() RETURNING room_id`,
        [connectionId],
      );
      return r.rowCount > 0;
    } catch {
      return false;
    }
  }
  async release(connectionId: string) {
    await this.core.db.query("DELETE FROM room_seats WHERE connection_id=$1", [
      connectionId,
    ]);
  }
  async close(a: Actor, id: string) {
    const room = await this.canEnter(a, id);
    if (room.host_id !== a.id && !["admin", "moderator"].includes(a.role))
      fail(403, "HOST", "Only the host can close this room.");
    await this.core.db.query(`UPDATE rooms SET status='closed' WHERE id=$1`, [
      id,
    ]);
  }
  async kick(a: Actor, roomId: string, target: string) {
    const room = await this.canEnter(a, roomId);
    if (room.host_id !== a.id && !["admin", "moderator"].includes(a.role))
      fail(403, "HOST", "Only the host can remove a participant.");
    await this.core.db.query(
      "INSERT INTO room_bans(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [roomId, target],
    );
    await this.core.db.query(
      "DELETE FROM room_seats WHERE room_id=$1 AND user_id=$2",
      [roomId, target],
    );
    await this.core.db.query(
      "DELETE FROM room_tickets WHERE room_id=$1 AND user_id=$2",
      [roomId, target],
    );
    await this.core.db.query(
      "DELETE FROM room_members WHERE room_id=$1 AND user_id=$2",
      [roomId, target],
    );
    await this.core.db.query(
      "INSERT INTO audit_events(id,actor_id,action,target_id,reason) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), a.id, "room.kick", target, roomId],
    );
  }
  async enqueue(a: Actor, mode: Mode) {
    await this.core.rate("queue:" + a.id, 15, 60);
    return this.core.db.transaction(async (db) => {
      await db.query("LOCK TABLE quick_queue IN EXCLUSIVE MODE");
      await db.query("DELETE FROM quick_queue WHERE expires_at<now()");
      await db.query(
        `UPDATE proposals SET status='expired' WHERE status='pending' AND expires_at<now()`,
      );
      const existing = (
        await db.query(
          `SELECT id FROM proposals WHERE status='pending' AND (a_id=$1 OR b_id=$1) AND expires_at>now()`,
          [a.id],
        )
      ).rows[0];
      if (existing) return { state: "proposed", proposalId: existing.id };
      const p = (
        await db.query("SELECT paused,modes FROM profiles WHERE user_id=$1", [
          a.id,
        ])
      ).rows[0];
      if (!p || p.paused || !p.modes.includes(mode))
        fail(
          403,
          "VISIBILITY",
          "Opt into this intention before joining its queue.",
        );
      if (
        (
          await db.query(
            "SELECT 1 FROM room_seats WHERE user_id=$1 AND expires_at>now()",
            [a.id],
          )
        ).rowCount
      )
        fail(409, "IN_CALL", "Leave your current room first.");
      const queue = await db.query(
        `SELECT q.user_id FROM quick_queue q WHERE q.user_id<>$1 AND q.mode=$2 AND NOT EXISTS(SELECT 1 FROM proposals p WHERE p.status='pending' AND (p.a_id=q.user_id OR p.b_id=q.user_id) AND p.expires_at>now()) AND NOT EXISTS(SELECT 1 FROM room_seats s WHERE s.user_id=q.user_id AND s.expires_at>now()) AND NOT EXISTS(SELECT 1 FROM proposals p WHERE ((p.a_id=$1 AND p.b_id=q.user_id) OR (p.b_id=$1 AND p.a_id=q.user_id)) AND p.created_at>now()-interval '30 minutes') ORDER BY q.created_at LIMIT 30`,
        [a.id, mode],
      );
      for (const q of queue.rows) {
        if (!(await this.core.eligible(a.id, q.user_id, mode, db))) continue;
        const prior = await db.query(
          `SELECT 1 FROM matches WHERE status='active' AND mode=$3 AND ((low_id=$1 AND high_id=$2) OR (low_id=$2 AND high_id=$1))`,
          [a.id, q.user_id, mode],
        );
        if (prior.rowCount) continue;
        const id = randomUUID();
        await db.query(
          `INSERT INTO proposals(id,a_id,b_id,mode,expires_at) VALUES($1,$2,$3,$4,now()+interval '20 seconds')`,
          [id, q.user_id, a.id, mode],
        );
        await db.query("DELETE FROM quick_queue WHERE user_id IN ($1,$2)", [
          a.id,
          q.user_id,
        ]);
        return { state: "proposed", proposalId: id };
      }
      await db.query(
        `INSERT INTO quick_queue(user_id,mode,expires_at) VALUES($1,$2,now()+interval '45 seconds') ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode,expires_at=excluded.expires_at`,
        [a.id, mode],
      );
      return { state: "queued" };
    });
  }
  async queueStatus(a: Actor) {
    const r = await this.core.db.query(
      `SELECT * FROM proposals WHERE (a_id=$1 OR b_id=$1) AND expires_at>now() AND status IN ('pending','accepted') ORDER BY created_at DESC LIMIT 1`,
      [a.id],
    );
    const p = r.rows[0];
    if (p) {
      if (!(await this.core.eligible(p.a_id, p.b_id, p.mode)))
        return { state: "idle" };
      return {
        state: p.status === "accepted" ? "ready" : "proposed",
        id: p.id,
        accepted: p.a_id === a.id ? p.a_accepted : p.b_accepted,
        person: await this.core.safeProfile(p.a_id === a.id ? p.b_id : p.a_id),
        expiresAt: p.expires_at,
        roomId: p.status === "accepted" ? p.room_id : undefined,
      };
    }
    const q = await this.core.db.query(
      "SELECT 1 FROM quick_queue WHERE user_id=$1 AND expires_at>now()",
      [a.id],
    );
    if (q.rowCount)
      await this.core.db.query(
        `UPDATE quick_queue SET expires_at=now()+interval '45 seconds' WHERE user_id=$1`,
        [a.id],
      );
    return { state: q.rowCount ? "queued" : "idle" };
  }
  async respond(a: Actor, id: string, accept: boolean) {
    return this.core.db.transaction(async (db) => {
      const p = (
        await db.query(
          `SELECT * FROM proposals WHERE id=$1 AND (a_id=$2 OR b_id=$2) AND status IN ('pending','accepted') AND expires_at>now() FOR UPDATE`,
          [id, a.id],
        )
      ).rows[0];
      if (!p || !(await this.core.eligible(p.a_id, p.b_id, p.mode, db)))
        fail(404, "PROPOSAL", "This proposal is no longer available.");
      if (p.status === "accepted") return { state: "ready", roomId: p.room_id };
      if (!accept) {
        await db.query(`UPDATE proposals SET status='declined' WHERE id=$1`, [
          id,
        ]);
        return { state: "idle" };
      }
      await db.query(
        `UPDATE proposals SET ${p.a_id === a.id ? "a_accepted" : "b_accepted"}=true WHERE id=$1`,
        [id],
      );
      const updated = (
        await db.query("SELECT * FROM proposals WHERE id=$1", [id])
      ).rows[0];
      if (!updated.a_accepted || !updated.b_accepted)
        return { state: "waiting" };
      const roomId = randomUUID(),
        conversationId = randomUUID();
      await db.query(
        `INSERT INTO rooms(id,title,topic,kind,capacity) VALUES($1,'Quick Match',$2,'quick',2)`,
        [roomId, p.mode],
      );
      await db.query(
        "INSERT INTO conversations(id,kind,room_id) VALUES($1,$2,$3)",
        [conversationId, "quick", roomId],
      );
      for (const id of [p.a_id, p.b_id]) {
        await db.query(
          "INSERT INTO room_members(room_id,user_id) VALUES($1,$2)",
          [roomId, id],
        );
        await db.query(
          "INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2)",
          [conversationId, id],
        );
      }
      await db.query(
        `UPDATE proposals SET status='accepted',room_id=$2,expires_at=now()+interval '5 minutes' WHERE id=$1`,
        [p.id, roomId],
      );
      return { state: "ready", roomId, conversationId };
    });
  }
  async cancel(a: Actor) {
    await this.core.db.transaction(async (db) => {
      await db.query("DELETE FROM quick_queue WHERE user_id=$1", [a.id]);
      await db.query(
        `UPDATE proposals SET status='cancelled' WHERE (a_id=$1 OR b_id=$1) AND status='pending'`,
        [a.id],
      );
    });
  }
  async invite(a: Actor, conversation: string) {
    await this.core.rate("invite:" + a.id, 10, 600);
    await this.core.membership(a, conversation);
    const peer = (
      await this.core.db.query(
        "SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND user_id<>$2",
        [conversation, a.id],
      )
    ).rows[0];
    if (!peer) fail(404, "CONVERSATION", "Conversation unavailable.");
    const prior = (
      await this.core.db.query(
        `SELECT id FROM call_invitations WHERE sender_id=$1 AND recipient_id=$2 AND status='pending' AND expires_at>now()`,
        [a.id, peer.user_id],
      )
    ).rows[0];
    if (prior) return prior;
    const id = randomUUID();
    await this.core.db.query(
      `INSERT INTO call_invitations(id,sender_id,recipient_id,conversation_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '2 minutes')`,
      [id, a.id, peer.user_id, conversation],
    );
    return { id };
  }
  async invitations(a: Actor) {
    const rows = await this.core.db.query(
      `SELECT id,sender_id,recipient_id,conversation_id,status,room_id,expires_at FROM call_invitations WHERE (recipient_id=$1 OR sender_id=$1) AND expires_at>now() AND status IN ('pending','accepted') ORDER BY created_at DESC LIMIT 20`,
      [a.id],
    );
    const results = [];
    for (const r of rows.rows) {
      try {
        await this.core.membership(a, r.conversation_id);
        results.push({
          ...r,
          person: await this.core.safeProfile(
            r.sender_id === a.id ? r.recipient_id : r.sender_id,
          ),
        });
      } catch {}
    }
    return results;
  }
  async respondInvite(a: Actor, id: string, accept: boolean) {
    return this.core.db.transaction(async (db) => {
      const i = (
        await db.query(
          `SELECT * FROM call_invitations WHERE id=$1 AND recipient_id=$2 AND expires_at>now() FOR UPDATE`,
          [id, a.id],
        )
      ).rows[0];
      if (!i || !["pending", "accepted"].includes(i.status))
        fail(404, "INVITATION", "Invitation unavailable.");
      await this.core.membership(a, i.conversation_id, db);
      if (i.status === "accepted") return { roomId: i.room_id };
      if (!accept) {
        await db.query(
          `UPDATE call_invitations SET status='declined' WHERE id=$1`,
          [id],
        );
        return { declined: true };
      }
      const roomId = randomUUID();
      await db.query(
        `INSERT INTO rooms(id,title,kind,capacity) VALUES($1,'Private conversation','date',2)`,
        [roomId],
      );
      for (const u of [i.sender_id, i.recipient_id])
        await db.query(
          "INSERT INTO room_members(room_id,user_id) VALUES($1,$2)",
          [roomId, u],
        );
      await db.query(
        `UPDATE call_invitations SET status='accepted',room_id=$2,expires_at=now()+interval '5 minutes' WHERE id=$1`,
        [id, roomId],
      );
      return { roomId };
    });
  }
}
