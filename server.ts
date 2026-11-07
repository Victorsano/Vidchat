import { createServer } from "node:http";
import next from "next";
import nextEnv from "@next/env";
import { attachSignaling } from "./signaling";
import { getDb, migrate } from "./lib/backend/db";
import { DorcasService } from "./lib/backend/service";
import { RoomService } from "./lib/backend/rooms";
import { setLive } from "./lib/backend/runtime";
import { cookies } from "./lib/backend/security";
import { removePhoto, storageReady } from "./lib/backend/storage";
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
const port = Number(process.env.PORT || 3000);
const app = next({
  dev: process.env.NODE_ENV !== "production",
  hostname: "0.0.0.0",
  port,
});
const db = await getDb();
await migrate(db);
await app.prepare();
const handler = app.getRequestHandler();
const server = createServer((req, res) => handler(req, res));
const core = new DorcasService(db),
  rooms = new RoomService(core);
const live = attachSignaling(server, {
  authenticate: (req) =>
    core.actor(
      cookies(
        new Request("http://localhost", {
          headers: { cookie: req.headers.cookie || "" },
        }),
      ).dorcas_session,
    ),
  claim: (a, t, id) => rooms.claim(a, t, id),
  refresh: (a, r, id) => rooms.refresh(a, r, id),
  release: (id) => rooms.release(id),
});
setLive(live);
server.listen(port, "0.0.0.0", () =>
  console.log(`MATCH ready at http://localhost:${port}`),
);
let cleaning = false;
const photoCleanup = setInterval(() => {
  if (cleaning || !storageReady()) return;
  cleaning = true;
  void (async () => {
    const photos = await db.query(
      `SELECT id,object_key FROM profile_photos WHERE status='delete_pending' LIMIT 20`,
    );
    for (const p of photos.rows) {
      try {
        await removePhoto(p.object_key);
        await db.query("DELETE FROM profile_photos WHERE id=$1", [p.id]);
      } catch {}
    }
  })()
    .catch(() => {})
    .finally(() => (cleaning = false));
}, 60000);
photoCleanup.unref();
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  clearInterval(photoCleanup);
  for (const client of live.clients) client.close(1001, "Server restarting");
  server.close(() => void db.close().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 25000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
