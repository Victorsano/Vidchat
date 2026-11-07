// Isolated local-only browser fixtures. Never run against a configured database.
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { getDb } from "../lib/backend/db";
import { hash, token } from "../lib/backend/security";
if (process.env.NODE_ENV === "production" || process.env.DATABASE_URL)
  throw new Error(
    "Fixtures are restricted to the local PGlite development database",
  );
await mkdir(".local", { recursive: true });
const db = await getDb();
const users = [];
for (const name of ["Local Test One", "Local Test Two", "Local Moderator"]) {
  const id = randomUUID(),
    raw = token(),
    session = randomUUID();
  await db.query(
    `INSERT INTO users(id,email,verified_at,status,role,birth_date_private,age_reviewed_at,consent_at) VALUES($1,$2,now(),'active',$3,'2000-01-01',now(),now())`,
    [
      id,
      `${id}@student.babcock.edu.ng`,
      name === "Local Moderator" ? "admin" : "student",
    ],
  );
  await db.query(
    `INSERT INTO profiles(user_id,display_name,bio,interests,modes,paused,review_status) VALUES($1,$2,'Local test fixture, not a real student.',ARRAY['Music','Reading','Design'],ARRAY['friends','study'],false,'approved')`,
    [id, name],
  );
  await db.query(
    `INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')`,
    [session, id, hash(raw)],
  );
  users.push({ id, name, token: raw });
}
await writeFile(".local/browser-fixtures.json", JSON.stringify(users), {
  mode: 0o600,
});
for (let i = 0; i < users.length; i++)
  await writeFile(
    `.local/browser-state-${i}.json`,
    JSON.stringify({
      cookies: [
        {
          name: "dorcas_session",
          value: users[i].token,
          domain: "localhost",
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 3600,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
    { mode: 0o600 },
  );
await db.close();
console.log(
  "Created isolated local browser fixtures in the ignored .local folder.",
);
