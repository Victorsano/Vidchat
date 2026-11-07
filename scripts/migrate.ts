import { getDb, migrate } from "../lib/backend/db";
const db = await getDb();
await migrate(db);
await db.close();
console.log("Database migrations complete.");
