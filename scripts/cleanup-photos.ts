import { getDb } from "../lib/backend/db";
import { removePhoto } from "../lib/backend/storage";
const db = await getDb();
let failed = 0;
const photos = await db.query(
  `SELECT id,object_key FROM profile_photos WHERE status='delete_pending' LIMIT 100`,
);
for (const p of photos.rows) {
  try {
    await removePhoto(p.object_key);
    await db.query("DELETE FROM profile_photos WHERE id=$1", [p.id]);
  } catch {
    failed++;
  }
}
await db.close();
console.log(
  JSON.stringify({ removed: photos.rowCount - failed, retry: failed }),
);
if (failed) process.exitCode = 1;
