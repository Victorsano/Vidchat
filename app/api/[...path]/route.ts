import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  services,
  disconnectUser,
  refreshLive,
} from "../../../lib/backend/runtime";
import {
  ApiError,
  cookie,
  cookies,
  fail,
  requireOrigin,
} from "../../../lib/backend/security";
import { getPhoto, putPhoto, storageReady } from "../../../lib/backend/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const mode = z.enum(["friends", "dating", "study"]);
const uuid = z.string().uuid();
async function bytes(request: Request, max: number) {
  if (Number(request.headers.get("content-length") || 0) > max)
    fail(413, "SIZE", "Request is too large.");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  if (reader)
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > max) {
        await reader.cancel();
        fail(413, "SIZE", "Request is too large.");
      }
      chunks.push(value);
    }
  return Buffer.concat(chunks);
}
async function body(request: Request) {
  const b = await bytes(request, 32 * 1024);
  try {
    return JSON.parse(b.toString());
  } catch {
    fail(422, "JSON", "Invalid JSON request.");
  }
}
const profile = z
  .object({
    birthDate: z.string().optional(),
    termsAccepted: z.literal(true).optional(),
    display_name: z.string().trim().min(2).max(40).optional(),
    bio: z.string().trim().min(1).max(300).optional(),
    department: z.string().trim().max(80).optional(),
    year_level: z.string().max(20).optional(),
    interests: z
      .array(
        z.enum([
          "Music",
          "Reading",
          "Design",
          "Gaming",
          "Art",
          "Photography",
          "Travel",
          "Coffee",
          "Food",
          "Study",
          "Sports",
          "Technology",
        ]),
      )
      .min(3)
      .max(10)
      .optional(),
    modes: z.array(mode).max(3).optional(),
    paused: z.boolean().optional(),
    show_age: z.boolean().optional(),
    show_department: z.boolean().optional(),
    age_min: z.number().int().min(18).max(100).optional(),
    age_max: z.number().int().min(18).max(100).optional(),
    gender: z.string().max(40).optional(),
    preferred_genders: z.array(z.string().max(40)).max(10).optional(),
  })
  .strict();
async function route(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const requestId = randomUUID();
  const json = (
    data: unknown,
    status = 200,
    headers: Record<string, string> = {},
  ) =>
    Response.json(data, {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-ID": requestId,
        ...headers,
      },
    });
  try {
    requireOrigin(request);
    const { path } = await params;
    const p = path.join("/"),
      method = request.method,
      url = new URL(request.url);
    const { core, rooms } = await services();
    if (p === "health" && method === "GET") {
      await core.db.query("SELECT 1");
      return json({
        ok: true,
        database: true,
        email: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
        storage: storageReady(),
        turn: !!(process.env.TURN_URLS && process.env.TURN_SECRET),
      });
    }
    if (p === "auth/start" && method === "POST") {
      const d = z
        .object({ email: z.string().email().max(254) })
        .parse(await body(request));
      return json(
        await core.start(
          d.email,
          request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown",
        ),
      );
    }
    if (p === "auth/verify" && method === "POST") {
      const d = z
        .object({
          email: z.string().email().max(254),
          code: z.string().regex(/^\d{6}$/),
          totp: z
            .string()
            .regex(/^\d{6}$/)
            .optional(),
        })
        .parse(await body(request));
      const verified = await core.verify(d.email, d.code, d.totp);
      return json({ status: verified.status }, 200, {
        "Set-Cookie": cookie(verified.token),
      });
    }
    const a = await core.actor(cookies(request).dorcas_session, false);
    if (p === "auth/logout" && method === "POST") {
      const d = z
        .object({ all: z.boolean().default(false) })
        .parse(await body(request));
      await core.logout(a, d.all);
      disconnectUser(a.id);
      return json({ ok: true }, 200, { "Set-Cookie": cookie("", true) });
    }
    if (p === "me" && method === "GET") return json(await core.me(a));
    if (p === "me" && method === "PATCH") {
      const result = await core.profile(a, profile.parse(await body(request)));
      if (result.status !== "active") disconnectUser(a.id);
      return json(result);
    }
    if (p === "me" && method === "DELETE") {
      await core.deleteAccount(a);
      disconnectUser(a.id);
      return json(
        {
          ok: true,
          message:
            "Account removed from discovery. Queued photo deletion and restricted safety retention may take longer.",
        },
        200,
        { "Set-Cookie": cookie("", true) },
      );
    }
    if (p === "me/photos" && method === "POST") {
      await core.rate("photo:" + a.id, 10, 3600);
      const data = await bytes(request, 5 * 1024 * 1024);
      if (!storageReady())
        fail(503, "STORAGE", "Photo storage is not configured yet.");
      const id = randomUUID(),
        key = `profiles/${a.id}/${id}.webp`;
      await core.db.transaction(async (db) => {
        await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [a.id]);
        const count = (
          await db.query(
            `SELECT count(*)::integer n FROM profile_photos WHERE user_id=$1 AND status<>'delete_pending'`,
            [a.id],
          )
        ).rows[0].n;
        if (count >= 6)
          fail(409, "PHOTO_LIMIT", "You can have up to six photos.");
        await db.query(
          "INSERT INTO profile_photos(id,user_id,object_key) VALUES($1,$2,$3)",
          [id, a.id, key],
        );
      });
      try {
        await putPhoto(a.id, data, id);
        await core.db.query(
          `UPDATE profile_photos SET status='uploaded' WHERE id=$1`,
          [id],
        );
      } catch (e) {
        await core.db.query(
          `UPDATE profile_photos SET status='delete_pending' WHERE id=$1`,
          [id],
        );
        throw e;
      }
      return json(
        {
          id,
          status: "uploaded",
          message: "Photo received for moderator review.",
        },
        201,
      );
    }
    if (path[0] === "photos" && path[1] && method === "GET") {
      const id = uuid.parse(path[1]);
      const photo = (
        await core.db.query("SELECT * FROM profile_photos WHERE id=$1", [id])
      ).rows[0];
      if (!photo || photo.status === "delete_pending")
        fail(404, "PHOTO", "Photo unavailable.");
      const privileged = ["admin", "moderator"].includes(a.role);
      if (photo.user_id !== a.id && !privileged) {
        await core.actor(cookies(request).dorcas_session);
        if (
          photo.status !== "approved" ||
          (await core.blocked(a.id, photo.user_id))
        )
          fail(404, "PHOTO", "Photo unavailable.");
        const connected = await core.db.query(
          `SELECT 1 FROM conversation_members x JOIN conversation_members y ON x.conversation_id=y.conversation_id JOIN conversations c ON c.id=x.conversation_id WHERE x.user_id=$1 AND y.user_id=$2 AND c.closed_at IS NULL`,
          [a.id, photo.user_id],
        );
        if (!connected.rowCount) {
          let allowed = false;
          for (const m of ["friends", "dating", "study"] as const)
            if (await core.eligible(a.id, photo.user_id, m)) allowed = true;
          if (!allowed) fail(404, "PHOTO", "Photo unavailable.");
        }
      }
      const r = await getPhoto(photo.object_key);
      return new Response(r.body, {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (p === "me/photos/delete" && method === "POST") {
      const d = z.object({ id: uuid }).parse(await body(request));
      await core.db.query(
        `UPDATE profile_photos SET status='delete_pending' WHERE id=$1 AND user_id=$2`,
        [d.id, a.id],
      );
      return json({ ok: true });
    }
    if (a.status !== "active")
      fail(
        403,
        "ONBOARDING",
        "Complete onboarding and eligibility review first.",
      );
    if (p === "discover" && method === "GET")
      return json(
        await core.discover(
          a,
          mode.parse(url.searchParams.get("mode") || "friends"),
          url.searchParams.get("cursor") || "",
        ),
      );
    if (path[0] === "people" && path[1] && method === "GET") {
      const id = uuid.parse(path[1]);
      if (
        !(await core.eligible(
          a.id,
          id,
          mode.parse(url.searchParams.get("mode") || "friends"),
        ))
      )
        fail(404, "PROFILE", "Profile unavailable.");
      return json(await core.safeProfile(id));
    }
    if (path[0] === "swipes" && path[1] && method === "PUT") {
      const d = z
        .object({ mode, decision: z.enum(["like", "pass"]) })
        .parse(await body(request));
      return json(await core.swipe(a, uuid.parse(path[1]), d.mode, d.decision));
    }
    if (p === "conversations" && method === "GET")
      return json(await core.conversations(a));
    if (path[0] === "conversations" && path[1]) {
      const id = uuid.parse(path[1]);
      if (path[2] === "messages" && method === "GET") {
        const before = url.searchParams.get("before");
        if (before) z.iso.datetime({ offset: true }).parse(before);
        return json(await core.messages(a, id, before || undefined));
      }
      if (path[2] === "messages" && method === "POST") {
        const d = z
          .object({ body: z.string().trim().min(1).max(2000), nonce: uuid })
          .parse(await body(request));
        return json(await core.message(a, id, d.body, d.nonce), 201);
      }
      if (path[2] === "unmatch" && method === "POST") {
        await core.unmatch(a, id);
        await refreshLive();
        return json({ ok: true });
      }
    }
    if (p === "rooms" && method === "GET") return json(await rooms.list(a));
    if (p === "rooms" && method === "POST") {
      const d = z
        .object({
          title: z.string().trim().min(1).max(80),
          topic: z.enum(["friends", "study", "music", "gaming"]),
          capacity: z.number().int().min(2).max(6).default(4),
        })
        .parse(await body(request));
      return json(await rooms.create(a, d.title, d.topic, d.capacity), 201);
    }
    if (path[0] === "rooms" && path[1]) {
      const id = uuid.parse(path[1]);
      if (path[2] === "join-ticket" && method === "POST")
        return json(await rooms.ticket(a, id));
      if (path[2] === "close" && method === "POST") {
        await rooms.close(a, id);
        await refreshLive();
        return json({ ok: true });
      }
      if (path[2] === "kick" && method === "POST") {
        const d = z.object({ userId: uuid }).parse(await body(request));
        await rooms.kick(a, id, d.userId);
        disconnectUser(d.userId);
        return json({ ok: true });
      }
    }
    if (p === "quick-match/enqueue" && method === "POST") {
      const d = z.object({ mode }).parse(await body(request));
      return json(await rooms.enqueue(a, d.mode));
    }
    if (p === "quick-match/status" && method === "GET")
      return json(await rooms.queueStatus(a));
    if (p === "quick-match/cancel" && method === "POST") {
      await rooms.cancel(a);
      return json({ ok: true });
    }
    if (
      path[0] === "quick-match" &&
      path[1] &&
      path[2] === "respond" &&
      method === "POST"
    ) {
      const d = z.object({ accept: z.boolean() }).parse(await body(request));
      return json(await rooms.respond(a, uuid.parse(path[1]), d.accept));
    }
    if (p === "call-invitations" && method === "GET")
      return json(await rooms.invitations(a));
    if (p === "call-invitations" && method === "POST") {
      const d = z.object({ conversationId: uuid }).parse(await body(request));
      return json(await rooms.invite(a, d.conversationId), 201);
    }
    if (
      path[0] === "call-invitations" &&
      path[1] &&
      path[2] === "respond" &&
      method === "POST"
    ) {
      const d = z.object({ accept: z.boolean() }).parse(await body(request));
      return json(await rooms.respondInvite(a, uuid.parse(path[1]), d.accept));
    }
    if (p === "blocks" && method === "GET") {
      return json(
        (
          await core.db.query(
            "SELECT blocked_id id FROM blocks WHERE blocker_id=$1",
            [a.id],
          )
        ).rows,
      );
    }
    if (p === "blocks" && method === "POST") {
      const d = z.object({ userId: uuid }).parse(await body(request));
      await core.block(a, d.userId);
      await refreshLive();
      return json({ ok: true });
    }
    if (p === "blocks" && method === "DELETE") {
      const d = z.object({ userId: uuid }).parse(await body(request));
      await core.db.query(
        "DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2",
        [a.id, d.userId],
      );
      return json({ ok: true });
    }
    if (p === "reports" && method === "POST") {
      const d = z
        .object({
          subjectId: uuid.optional(),
          roomId: uuid.optional(),
          category: z.enum([
            "harassment",
            "sexual_content",
            "underage",
            "impersonation",
            "spam",
            "other",
          ]),
          description: z.string().trim().max(1000).default(""),
        })
        .parse(await body(request));
      return json(await core.report(a, d), 201);
    }
    if (p === "campus" && method === "GET") {
      const groups = await core.db.query(
        `SELECT g.id,g.title,g.description,EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=$1) joined FROM campus_groups g ORDER BY g.title`,
        [a.id],
      );
      const events = await core.db.query(
        `SELECT id,title,description,starts_at FROM events WHERE status='approved' AND starts_at>now() ORDER BY starts_at LIMIT 20`,
      );
      return json({ groups: groups.rows, events: events.rows });
    }
    if (path[0] === "groups" && path[1]) {
      const id = uuid.parse(path[1]);
      if (path[2] === "join" && method === "POST") {
        await core.db.query(
          "INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [id, a.id],
        );
        return json({ ok: true });
      }
      if (path[2] === "leave" && method === "POST") {
        await core.db.query(
          "DELETE FROM group_members WHERE group_id=$1 AND user_id=$2",
          [id, a.id],
        );
        return json({ ok: true });
      }
      if (path[2] === "posts") {
        if (
          !(
            await core.db.query(
              "SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2",
              [id, a.id],
            )
          ).rowCount
        )
          fail(403, "MEMBERSHIP", "Join this circle first.");
        if (method === "GET")
          return json(
            (
              await core.db.query(
                `SELECT p.id,p.body,p.created_at,p.author_id,pr.display_name name FROM posts p JOIN profiles pr ON pr.user_id=p.author_id JOIN users u ON u.id=p.author_id WHERE p.group_id=$1 AND p.status='approved' AND u.status='active' AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=$2 AND b.blocked_id=p.author_id) OR (b.blocked_id=$2 AND b.blocker_id=p.author_id)) ORDER BY p.created_at DESC LIMIT 40`,
                [id, a.id],
              )
            ).rows,
          );
        if (method === "POST") {
          await core.rate("post:" + a.id, 10, 3600);
          const d = z
            .object({ body: z.string().trim().min(1).max(2000) })
            .parse(await body(request));
          const postId = randomUUID();
          await core.db.query(
            "INSERT INTO posts(id,group_id,author_id,body) VALUES($1,$2,$3,$4)",
            [postId, id, a.id, d.body],
          );
          return json({ id: postId, status: "pending" }, 201);
        }
      }
    }
    if (path[0] === "admin") {
      if (!["moderator", "admin"].includes(a.role))
        fail(403, "ROLE", "Moderator access is required.");
      if (p === "admin/review" && method === "GET") {
        const students = await core.db.query(
          `SELECT u.id,u.email,u.birth_date_private,u.created_at,p.display_name,p.bio,p.interests FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.status='review' ORDER BY u.created_at LIMIT 50`,
        );
        const photos = await core.db.query(
          `SELECT id,user_id,status FROM profile_photos WHERE status='uploaded' LIMIT 50`,
        );
        const reports = await core.db.query(
          `SELECT * FROM reports WHERE status='open' ORDER BY created_at LIMIT 50`,
        );
        const posts = await core.db.query(
          `SELECT id,body,author_id,group_id FROM posts WHERE status='pending' LIMIT 50`,
        );
        return json({
          students: students.rows,
          photos: photos.rows,
          reports: reports.rows,
          posts: posts.rows,
        });
      }
      if (p === "admin/review" && method === "POST") {
        const d = z
          .object({
            userId: uuid,
            action: z.enum(["approve", "suspend", "reject"]),
            reason: z.string().trim().min(10).max(500),
          })
          .parse(await body(request));
        await core.review(a, d.userId, d.action, d.reason);
        disconnectUser(d.userId);
        return json({ ok: true });
      }
      if (p === "admin/photo" && method === "POST") {
        const d = z
          .object({
            id: uuid,
            approve: z.boolean(),
            reason: z.string().min(5).max(500),
          })
          .parse(await body(request));
        await core.db.transaction(async (db) => {
          await db.query(
            `UPDATE profile_photos SET status=$2 WHERE id=$1 AND status='uploaded'`,
            [d.id, d.approve ? "approved" : "rejected"],
          );
          await db.query(
            "INSERT INTO audit_events(id,actor_id,action,target_id,reason) VALUES($1,$2,$3,$4,$5)",
            [randomUUID(), a.id, "photo.review", d.id, d.reason],
          );
        });
        return json({ ok: true });
      }
      if (p === "admin/post" && method === "POST") {
        const d = z
          .object({
            id: uuid,
            approve: z.boolean(),
            reason: z.string().min(5).max(500),
          })
          .parse(await body(request));
        await core.db.transaction(async (db) => {
          await db.query("UPDATE posts SET status=$2 WHERE id=$1", [
            d.id,
            d.approve ? "approved" : "rejected",
          ]);
          await db.query(
            "INSERT INTO audit_events(id,actor_id,action,target_id,reason) VALUES($1,$2,$3,$4,$5)",
            [randomUUID(), a.id, "post.review", d.id, d.reason],
          );
        });
        return json({ ok: true });
      }
      if (p === "admin/report" && method === "POST") {
        const d = z.object({ id: uuid }).parse(await body(request));
        await core.db.query(
          `UPDATE reports SET status='resolved' WHERE id=$1`,
          [d.id],
        );
        return json({ ok: true });
      }
      if (p === "admin/events" && method === "POST") {
        const d = z
          .object({
            title: z.string().trim().min(1).max(100),
            description: z.string().max(1000),
            startsAt: z.iso.datetime({ offset: true }),
          })
          .parse(await body(request));
        const id = randomUUID();
        await core.db.query(
          "INSERT INTO events(id,title,description,starts_at) VALUES($1,$2,$3,$4)",
          [id, d.title, d.description, d.startsAt],
        );
        return json({ id }, 201);
      }
    }
    fail(404, "NOT_FOUND", "Endpoint unavailable.");
  } catch (e) {
    if (e instanceof z.ZodError)
      return json(
        {
          error: {
            code: "VALIDATION",
            message: e.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join(";"),
          },
          requestId,
        },
        422,
      );
    if (e instanceof ApiError)
      return json(
        { error: { code: e.code, message: e.message }, requestId },
        e.status,
      );
    console.error("request_failed", {
      requestId,
      kind: e instanceof Error ? e.name : "Error",
    });
    return json(
      {
        error: {
          code: "UNAVAILABLE",
          message: "This service is temporarily unavailable.",
        },
        requestId,
      },
      503,
    );
  }
}
export {
  route as GET,
  route as POST,
  route as PATCH,
  route as PUT,
  route as DELETE,
};
