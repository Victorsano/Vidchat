import { randomUUID } from "node:crypto";
import type { Database } from "./db";
import {
  adult,
  ageAt,
  admins,
  eligibleEmail,
  equal,
  fail,
  hash,
  normalizeEmail,
  otp,
  otpHash,
  token,
  validTotp,
} from "./security";
import { sendCode } from "./email";
export type Actor = {
  id: string;
  email: string;
  status: string;
  role: string;
  session_id: string;
};
export type Mode = "friends" | "dating" | "study";
export class DorcasService {
  constructor(
    public db: Database,
    private deliver: (email: string, code: string) => Promise<void> = sendCode,
  ) {}
  async rate(key: string, max: number, seconds: number) {
    const r = await this.db.query(
      `INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN excluded.expires_at ELSE rate_limits.expires_at END RETURNING count`,
      [hash(key), seconds],
    );
    if (r.rows[0].count > max)
      fail(429, "RATE_LIMIT", "Too many requests. Please try again later.");
  }
  async start(emailInput: string, ip: string) {
    const email = normalizeEmail(emailInput);
    if (!eligibleEmail(email) && !admins().has(email))
      fail(422, "SCHOOL_EMAIL", "Use your @student.babcock.edu.ng email.");
    await this.rate("otp-global", 1000, 3600);
    await this.rate("otp-ip:" + ip, 15, 600);
    await this.rate("otp:" + email, 5, 3600);
    const code = otp();
    const inserted = await this.db.query(
      `INSERT INTO email_challenges(email,code_hash,expires_at) VALUES($1,$2,now()+interval '10 minutes') ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,consumed_at=NULL,created_at=now() WHERE email_challenges.created_at<now()-interval '60 seconds' RETURNING email`,
      [email, otpHash(email, code)],
    );
    if (!inserted.rowCount)
      fail(
        429,
        "COOLDOWN",
        "Please wait 60 seconds before requesting another code.",
      );
    try {
      await this.deliver(email, code);
    } catch {
      await this.db.query(
        "DELETE FROM email_challenges WHERE email=$1 AND code_hash=$2",
        [email, otpHash(email, code)],
      );
      fail(
        503,
        "EMAIL_UNAVAILABLE",
        "Verification email is temporarily unavailable. Please try again later.",
      );
    }
    return {
      accepted: true,
      message: "If eligible, a verification code has been sent.",
    };
  }
  async verify(inputEmail: string, code: string, totp?: string) {
    const email = normalizeEmail(inputEmail);
    await this.rate("verify:" + email, 15, 600);
    if (admins().has(email) && process.env.NODE_ENV === "production") {
      let secrets: Record<string, string> = {};
      try {
        secrets = JSON.parse(process.env.ADMIN_TOTP_SECRETS || "{}");
      } catch {}
      if (!secrets[email])
        fail(503, "ADMIN_SETUP", "Moderator second-factor setup is required.");
      if (!totp || !validTotp(secrets[email], totp))
        fail(
          422,
          "SECOND_FACTOR",
          "A valid moderator security code is required.",
        );
    }
    const raw = token();
    const result = await this.db.transaction(async (tx) => {
      const r = await tx.query(
        "SELECT * FROM email_challenges WHERE email=$1 FOR UPDATE",
        [email],
      );
      const c = r.rows[0];
      if (
        !c ||
        c.consumed_at ||
        new Date(c.expires_at) <= new Date() ||
        c.attempts >= 5
      )
        return null;
      await tx.query(
        "UPDATE email_challenges SET attempts=attempts+1 WHERE email=$1",
        [email],
      );
      if (!equal(c.code_hash, otpHash(email, code))) return null;
      await tx.query(
        "UPDATE email_challenges SET consumed_at=now() WHERE email=$1",
        [email],
      );
      const admin = admins().has(email);
      await tx.query(
        `INSERT INTO users(id,email,verified_at,status,role) VALUES($1,$2,now(),$3,$4) ON CONFLICT(email) DO NOTHING`,
        [
          randomUUID(),
          email,
          admin ? "active" : "onboarding",
          admin ? "admin" : "student",
        ],
      );
      const u = (await tx.query("SELECT * FROM users WHERE email=$1", [email]))
        .rows[0];
      if (u.status === "deleted" || u.status === "suspended") return null;
      await tx.query(
        "INSERT INTO profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING",
        [u.id],
      );
      await tx.query(
        `INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '7 days')`,
        [randomUUID(), u.id, hash(raw)],
      );
      return { status: u.status };
    });
    if (!result)
      fail(
        422,
        "INVALID_CODE",
        "The code is invalid, expired, or already used.",
      );
    return { token: raw, status: result!.status };
  }
  async actor(raw: string | undefined, active = true): Promise<Actor> {
    if (!raw) fail(401, "SESSION", "Please sign in.");
    const r = await this.db.query(
      `SELECT u.id,u.email,u.status,u.role,s.id session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL AND u.status NOT IN ('deleted','suspended')`,
      [hash(raw!)],
    );
    const user = r.rows[0] as Actor | undefined;
    if (!user)
      fail(401, "SESSION", "Your session has expired. Please sign in.");
    if (active && user!.status !== "active")
      fail(
        403,
        "ONBOARDING",
        "Complete onboarding and eligibility review first.",
      );
    return user!;
  }
  async me(a: Actor) {
    const r = await this.db.query("SELECT * FROM profiles WHERE user_id=$1", [
      a.id,
    ]);
    const photos = await this.db.query(
      "SELECT id,status FROM profile_photos WHERE user_id=$1 ORDER BY created_at",
      [a.id],
    );
    return {
      id: a.id,
      email: a.email,
      status: a.status,
      role: a.role,
      profile: r.rows[0],
      photos: photos.rows,
    };
  }
  async profile(a: Actor, input: any) {
    if (input.birthDate && input.termsAccepted !== true)
      fail(
        422,
        "CONSENT",
        "Accept the Terms and Privacy notice before submitting eligibility information.",
      );
    if (input.birthDate && !adult(input.birthDate))
      fail(
        422,
        "ADULT_REQUIRED",
        "Accounts are limited to adults aged 18 or over.",
      );
    await this.db.transaction(async (tx) => {
      const prior = (
        await tx.query(
          "SELECT display_name,bio,department,year_level FROM profiles WHERE user_id=$1",
          [a.id],
        )
      ).rows[0];
      if (input.birthDate) {
        const u = (
          await tx.query(
            "SELECT birth_date_private,status FROM users WHERE id=$1 FOR UPDATE",
            [a.id],
          )
        ).rows[0];
        if (u.birth_date_private && u.status === "active")
          fail(
            409,
            "AGE_LOCKED",
            "Contact support to correct an approved birth date.",
          );
        await tx.query(
          `UPDATE users SET birth_date_private=$2,consent_at=now(),status=CASE WHEN status='onboarding' THEN 'review' ELSE status END WHERE id=$1`,
          [a.id, input.birthDate],
        );
      }
      const keys = [
        "display_name",
        "bio",
        "department",
        "year_level",
        "interests",
        "modes",
        "paused",
        "show_age",
        "show_department",
        "age_min",
        "age_max",
        "gender",
        "preferred_genders",
      ];
      const entries = keys.filter((k) => input[k] !== undefined);
      if (entries.length)
        await tx.query(
          `UPDATE profiles SET ${entries.map((k, i) => `${k}=$${i + 2}`).join(",")},updated_at=now() WHERE user_id=$1`,
          [a.id, ...entries.map((k) => input[k])],
        );
      const p = (
        await tx.query(
          "SELECT age_min,age_max FROM profiles WHERE user_id=$1",
          [a.id],
        )
      ).rows[0];
      if (p.age_min > p.age_max)
        fail(422, "PREFERENCES", "Minimum age must not exceed maximum age.");
      if (
        a.status === "active" &&
        a.role === "student" &&
        ["display_name", "bio", "department", "year_level"].some(
          (k) => input[k] !== undefined && input[k] !== prior[k],
        )
      ) {
        await tx.query(
          "UPDATE profiles SET review_status='pending' WHERE user_id=$1",
          [a.id],
        );
        await tx.query("UPDATE users SET status='review' WHERE id=$1", [a.id]);
      }
      if (input.paused === true) {
        await tx.query("DELETE FROM quick_queue WHERE user_id=$1", [a.id]);
        await tx.query(
          "UPDATE proposals SET status='cancelled' WHERE (a_id=$1 OR b_id=$1) AND status='pending'",
          [a.id],
        );
      }
    });
    return this.me(await this.actorById(a));
  }
  private async actorById(a: Actor) {
    const r = await this.db.query("SELECT status FROM users WHERE id=$1", [
      a.id,
    ]);
    return { ...a, status: r.rows[0].status };
  }
  async blocked(a: string, b: string, db = this.db) {
    return (
      (
        await db.query(
          "SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)",
          [a, b],
        )
      ).rowCount > 0
    );
  }
  async eligible(a: string, b: string, mode: Mode, db = this.db) {
    if (a === b || (await this.blocked(a, b, db))) return false;
    const r = await db.query(
      `SELECT u.id,u.status,u.birth_date_private,p.* FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id IN ($1,$2)`,
      [a, b],
    );
    if (r.rowCount !== 2) return false;
    const x = r.rows.find((p) => p.user_id === a),
      y = r.rows.find((p) => p.user_id === b);
    if (!x || !y) return false;
    for (const p of [x, y])
      if (
        p.status !== "active" ||
        p.review_status !== "approved" ||
        p.paused ||
        !p.modes.includes(mode) ||
        !adult(new Date(p.birth_date_private).toISOString().slice(0, 10))
      )
        return false;
    const age = (p: any) => ageAt(new Date(p.birth_date_private).toISOString());
    if (
      age(y) < x.age_min ||
      age(y) > x.age_max ||
      age(x) < y.age_min ||
      age(x) > y.age_max
    )
      return false;
    if (
      mode === "dating" &&
      ((x.preferred_genders.length &&
        !x.preferred_genders.includes(y.gender)) ||
        (y.preferred_genders.length && !y.preferred_genders.includes(x.gender)))
    )
      return false;
    return true;
  }
  async safeProfile(id: string, db = this.db) {
    const r = await db.query(
      `SELECT p.user_id id,p.display_name name,p.bio,p.interests,p.modes,p.show_age,p.show_department,p.department,p.year_level,u.birth_date_private FROM profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1`,
      [id],
    );
    const p = r.rows[0];
    if (!p) fail(404, "NOT_FOUND", "Profile unavailable.");
    const photos = await db.query(
      `SELECT id FROM profile_photos WHERE user_id=$1 AND status='approved' ORDER BY created_at LIMIT 6`,
      [id],
    );
    return {
      id: p.id,
      name: p.name,
      bio: p.bio,
      interests: p.interests,
      modes: p.modes,
      department: p.show_department ? p.department : undefined,
      year: p.show_department ? p.year_level : undefined,
      age: p.show_age
        ? ageAt(new Date(p.birth_date_private).toISOString())
        : undefined,
      photos: photos.rows.map((p) => `/api/photos/${p.id}`),
    };
  }
  async discover(a: Actor, mode: Mode, cursor = "") {
    const ids = await this.db.query(
      `SELECT p.user_id FROM profiles p JOIN users u ON p.user_id=u.id WHERE u.status='active' AND p.review_status='approved' AND NOT p.paused AND p.user_id<>$1 AND p.user_id::text>$2 AND $3=ANY(p.modes) AND NOT EXISTS(SELECT 1 FROM swipes s WHERE s.actor_id=$1 AND s.target_id=p.user_id AND s.mode=$3 AND (s.decision='like' OR s.created_at>now()-interval '30 days')) AND NOT EXISTS(SELECT 1 FROM matches m WHERE m.status='active' AND m.mode=$3 AND ((m.low_id=$1 AND m.high_id=p.user_id) OR (m.high_id=$1 AND m.low_id=p.user_id))) ORDER BY p.user_id LIMIT 40`,
      [a.id, cursor, mode],
    );
    const profiles = [];
    for (const row of ids.rows)
      if (await this.eligible(a.id, row.user_id, mode))
        profiles.push(await this.safeProfile(row.user_id));
    const me = (
      await this.db.query("SELECT interests FROM profiles WHERE user_id=$1", [
        a.id,
      ])
    ).rows[0];
    profiles.sort(
      (x, y) =>
        y.interests.filter((t: string) => me.interests.includes(t)).length -
        x.interests.filter((t: string) => me.interests.includes(t)).length,
    );
    return {
      profiles,
      nextCursor: ids.rowCount === 40 ? ids.rows.at(-1)!.user_id : null,
    };
  }
  async swipe(a: Actor, target: string, mode: Mode, decision: "like" | "pass") {
    return this.db.transaction(async (tx) => {
      await tx.query(
        "SELECT id FROM users WHERE id IN ($1,$2) ORDER BY id FOR UPDATE",
        [a.id, target],
      );
      if (!(await this.eligible(a.id, target, mode, tx)))
        fail(404, "NOT_FOUND", "Profile unavailable.");
      const photos = await tx.query(
        `SELECT count(DISTINCT user_id)::integer n FROM profile_photos WHERE user_id IN ($1,$2) AND status='approved'`,
        [a.id, target],
      );
      if (photos.rows[0].n !== 2)
        fail(
          403,
          "PHOTO_REQUIRED",
          "Add an approved profile photo before SwipeChat.",
        );
      await tx.query(
        `INSERT INTO swipes(actor_id,target_id,mode,decision) VALUES($1,$2,$3,$4) ON CONFLICT(actor_id,target_id,mode) DO UPDATE SET decision=excluded.decision,created_at=now()`,
        [a.id, target, mode, decision],
      );
      if (decision === "pass") return { matched: false };
      const reciprocal = await tx.query(
        `SELECT 1 FROM swipes WHERE actor_id=$1 AND target_id=$2 AND mode=$3 AND decision='like'`,
        [target, a.id, mode],
      );
      if (!reciprocal.rowCount) return { matched: false };
      const [low, high] = [a.id, target].sort();
      await tx.query(
        `INSERT INTO matches(id,low_id,high_id,mode) VALUES($1,$2,$3,$4) ON CONFLICT(low_id,high_id,mode) DO NOTHING`,
        [randomUUID(), low, high, mode],
      );
      const m = (
        await tx.query(
          `SELECT id,status FROM matches WHERE low_id=$1 AND high_id=$2 AND mode=$3`,
          [low, high, mode],
        )
      ).rows[0];
      if (m.status !== "active")
        fail(409, "UNMATCHED", "This connection has ended.");
      await tx.query(
        "INSERT INTO conversations(id,match_id) VALUES($1,$2) ON CONFLICT(match_id) DO NOTHING",
        [randomUUID(), m.id],
      );
      const c = (
        await tx.query("SELECT id FROM conversations WHERE match_id=$1", [m.id])
      ).rows[0];
      for (const id of [a.id, target])
        await tx.query(
          "INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [c.id, id],
        );
      return { matched: true, conversationId: c.id };
    });
  }
  async membership(a: Actor, id: string, db = this.db) {
    const r = await db.query(
      `SELECT c.id FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE c.id=$1 AND cm.user_id=$2 AND c.closed_at IS NULL AND NOT EXISTS(SELECT 1 FROM conversation_members other JOIN blocks b ON (b.blocker_id=$2 AND b.blocked_id=other.user_id) OR (b.blocked_id=$2 AND b.blocker_id=other.user_id) WHERE other.conversation_id=c.id)`,
      [id, a.id],
    );
    if (!r.rowCount) fail(404, "NOT_FOUND", "Conversation unavailable.");
  }
  async conversations(a: Actor) {
    const r = await this.db.query(
      `SELECT c.id,c.kind FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE cm.user_id=$1 AND c.closed_at IS NULL ORDER BY c.created_at DESC LIMIT 50`,
      [a.id],
    );
    const result = [];
    for (const c of r.rows) {
      try {
        await this.membership(a, c.id);
      } catch {
        continue;
      }
      const peer = (
        await this.db.query(
          "SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND user_id<>$2",
          [c.id, a.id],
        )
      ).rows[0];
      if (!peer) continue;
      const last = (
        await this.db.query(
          "SELECT body,created_at,sender_id FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
          [c.id],
        )
      ).rows[0];
      const unread = (
        await this.db.query(
          `SELECT count(*)::integer count FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$2 WHERE m.conversation_id=$1 AND m.sender_id<>$2 AND m.created_at>cm.last_read_at`,
          [c.id, a.id],
        )
      ).rows[0].count;
      result.push({
        ...c,
        person: await this.safeProfile(peer.user_id),
        last,
        unread,
      });
    }
    return result;
  }
  async messages(a: Actor, id: string, before?: string) {
    await this.membership(a, id);
    const r = await this.db.query(
      `SELECT id,sender_id,body,created_at FROM messages WHERE conversation_id=$1 AND ($2::timestamptz IS NULL OR created_at<$2) ORDER BY created_at DESC,id DESC LIMIT 50`,
      [id, before || null],
    );
    await this.db.query(
      "UPDATE conversation_members SET last_read_at=now() WHERE conversation_id=$1 AND user_id=$2",
      [id, a.id],
    );
    return r.rows.reverse();
  }
  async message(a: Actor, id: string, body: string, nonce: string) {
    await this.rate("message:" + a.id, 60, 60);
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT id FROM conversations WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      await this.membership(a, id, tx);
      const r = await tx.query(
        `INSERT INTO messages(id,conversation_id,sender_id,client_nonce,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(conversation_id,sender_id,client_nonce) DO UPDATE SET client_nonce=excluded.client_nonce RETURNING id,sender_id,body,created_at`,
        [randomUUID(), id, a.id, nonce, body],
      );
      return r.rows[0];
    });
  }
  async unmatch(a: Actor, id: string) {
    await this.db.transaction(async (tx) => {
      await this.membership(a, id, tx);
      await tx.query(
        `UPDATE matches SET status='unmatched' WHERE id=(SELECT match_id FROM conversations WHERE id=$1)`,
        [id],
      );
      await tx.query("UPDATE conversations SET closed_at=now() WHERE id=$1", [
        id,
      ]);
      await tx.query(
        `UPDATE rooms SET status='closed' WHERE id IN (SELECT room_id FROM call_invitations WHERE conversation_id=$1) OR id=(SELECT room_id FROM conversations WHERE id=$1)`,
        [id],
      );
      await tx.query(
        `UPDATE call_invitations SET status='cancelled' WHERE conversation_id=$1 AND status='pending'`,
        [id],
      );
    });
  }
  async block(a: Actor, target: string) {
    if (a.id === target) fail(422, "SELF_BLOCK", "You cannot block yourself.");
    await this.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [a.id, target],
      );
      await tx.query(
        `UPDATE conversations SET closed_at=now() WHERE id IN(SELECT x.conversation_id FROM conversation_members x JOIN conversation_members y ON x.conversation_id=y.conversation_id WHERE x.user_id=$1 AND y.user_id=$2)`,
        [a.id, target],
      );
      await tx.query(
        `UPDATE matches SET status='blocked' WHERE (low_id=$1 AND high_id=$2) OR (low_id=$2 AND high_id=$1)`,
        [a.id, target],
      );
      await tx.query(
        `UPDATE proposals SET status='cancelled' WHERE (a_id IN ($1,$2) OR b_id IN ($1,$2)) AND status='pending'`,
        [a.id, target],
      );
      await tx.query("DELETE FROM quick_queue WHERE user_id IN ($1,$2)", [
        a.id,
        target,
      ]);
      await tx.query(
        `UPDATE call_invitations SET status='cancelled' WHERE (sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1)`,
        [a.id, target],
      );
    });
  }
  async report(
    a: Actor,
    input: {
      subjectId?: string;
      roomId?: string;
      category: string;
      description: string;
    },
  ) {
    if (!input.subjectId && !input.roomId)
      fail(422, "CONTEXT", "Choose a profile or room to report.");
    if (input.subjectId && input.subjectId !== a.id) {
      const known = await this.db.query(
        "SELECT 1 FROM users WHERE id=$1 AND status<>$2",
        [input.subjectId, "deleted"],
      );
      if (!known.rowCount) fail(404, "NOT_FOUND", "Profile unavailable.");
    }
    const id = randomUUID();
    await this.db.query(
      "INSERT INTO reports(id,reporter_id,subject_id,room_id,category,description) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id,
        a.id,
        input.subjectId || null,
        input.roomId || null,
        input.category,
        input.description,
      ],
    );
    return { id };
  }
  async logout(a: Actor, all = false) {
    await this.db.query(
      `UPDATE sessions SET revoked_at=now() WHERE user_id=$1 ${all ? "" : "AND id=$2"}`,
      all ? [a.id] : [a.id, a.session_id],
    );
  }
  async deleteAccount(a: Actor) {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE users SET status='deleted',email=$2,birth_date_private=NULL WHERE id=$1`,
        [a.id, `${a.id}@deleted.invalid`],
      );
      await tx.query(
        `UPDATE profiles SET display_name='',bio='',department='',year_level='',interests='{}',modes='{}',paused=true,gender='',preferred_genders='{}' WHERE user_id=$1`,
        [a.id],
      );
      await tx.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1", [
        a.id,
      ]);
      await tx.query("DELETE FROM quick_queue WHERE user_id=$1", [a.id]);
      await tx.query("DELETE FROM room_seats WHERE user_id=$1", [a.id]);
      await tx.query(
        `UPDATE proposals SET status='cancelled' WHERE a_id=$1 OR b_id=$1`,
        [a.id],
      );
      await tx.query(
        `UPDATE conversations SET closed_at=now() WHERE id IN(SELECT conversation_id FROM conversation_members WHERE user_id=$1)`,
        [a.id],
      );
      await tx.query(
        `UPDATE messages SET body='[deleted]' WHERE sender_id=$1`,
        [a.id],
      );
      await tx.query(
        `UPDATE profile_photos SET status='delete_pending' WHERE user_id=$1`,
        [a.id],
      );
      await tx.query(
        `UPDATE posts SET body='[deleted]',status='deleted' WHERE author_id=$1`,
        [a.id],
      );
    });
  }
  async review(
    a: Actor,
    userId: string,
    action: "approve" | "suspend" | "reject",
    reason: string,
  ) {
    if (!["admin", "moderator"].includes(a.role))
      fail(403, "ROLE", "Moderator access is required.");
    await this.db.transaction(async (tx) => {
      const u = (
        await tx.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [userId])
      ).rows[0];
      if (!u || u.role !== "student")
        fail(404, "NOT_FOUND", "Student unavailable.");
      if (action === "approve") {
        if (
          !u.verified_at ||
          !u.birth_date_private ||
          !adult(new Date(u.birth_date_private).toISOString().slice(0, 10))
        )
          fail(
            422,
            "AGE_REVIEW",
            "A verified mailbox and adult birth date are required.",
          );
        const p = (
          await tx.query("SELECT * FROM profiles WHERE user_id=$1", [userId])
        ).rows[0];
        if (
          !p ||
          p.display_name.length < 2 ||
          p.bio.length < 1 ||
          p.interests.length < 3
        )
          fail(422, "PROFILE", "The student must complete their profile.");
        await tx.query(
          `UPDATE users SET status='active',age_reviewed_at=now() WHERE id=$1`,
          [userId],
        );
        await tx.query(
          `UPDATE profiles SET review_status='approved' WHERE user_id=$1`,
          [userId],
        );
      } else {
        await tx.query("UPDATE users SET status=$2 WHERE id=$1", [
          userId,
          action === "suspend" ? "suspended" : "review",
        ]);
        await tx.query(
          `UPDATE profiles SET review_status='rejected',paused=true WHERE user_id=$1`,
          [userId],
        );
        await tx.query(
          "UPDATE sessions SET revoked_at=now() WHERE user_id=$1",
          [userId],
        );
      }
      await tx.query(
        "INSERT INTO audit_events(id,actor_id,action,target_id,reason) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), a.id, action, userId, reason],
      );
    });
  }
}
