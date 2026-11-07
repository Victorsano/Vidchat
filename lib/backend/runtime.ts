import { getDb } from "./db";
import { DorcasService } from "./service";
import { RoomService } from "./rooms";
export async function services() {
  const core = new DorcasService(await getDb());
  return { core, rooms: new RoomService(core) };
}
type LiveControl = {
  reconcile: () => Promise<void>;
  disconnectUser: (id: string) => void;
};
const runtime = globalThis as unknown as { dorcasLive?: LiveControl };
export const setLive = (live: LiveControl) => {
  runtime.dorcasLive = live;
};
export const refreshLive = () => runtime.dorcasLive?.reconcile();
export const disconnectUser = (id: string) =>
  runtime.dorcasLive?.disconnectUser(id);
