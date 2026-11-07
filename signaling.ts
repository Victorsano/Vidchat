import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "node:http";
import { createSignalQueue } from "./lib/signal-queue";
type Identity = { roomId: string; userId: string; name?: string };
export type SignalingAuth = {
  authenticate: (req: IncomingMessage) => Promise<any>;
  claim: (actor: any, ticket: string, id: string) => Promise<Identity>;
  refresh: (actor: any, room: string, id: string) => Promise<boolean>;
  release: (id: string) => Promise<void>;
};
export function attachSignaling(server: Server, auth?: SignalingAuth) {
  if (!auth && process.env.NODE_ENV === "production")
    throw new Error("Production signaling requires authentication");
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const peers = new Map<
    string,
    {
      ws: WebSocket;
      alive: boolean;
      roomId: string;
      userId: string;
      name?: string;
      actor: any;
      media: { mic: boolean; camera: boolean };
    }
  >();
  const send = (ws: WebSocket, m: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };
  const broadcast = (room: string, m: unknown, except?: string) =>
    peers.forEach((p, id) => {
      if (p.roomId === room && id !== except) send(p.ws, m);
    });
  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url || "/", "http://localhost").pathname !== "/signal")
      return;
    void (async () => {
      try {
        const origin = req.headers.origin;
        if (
          (auth && !origin) ||
          (origin && new URL(origin).host !== req.headers.host)
        )
          throw new Error("Origin");
        const actor = auth ? await auth.authenticate(req) : null;
        if (socket.destroyed) return;
        wss.handleUpgrade(req, socket, head, (ws) =>
          wss.emit("connection", ws, actor),
        );
      } catch {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
      }
    })();
  });
  wss.on("connection", (ws: WebSocket, actor: any) => {
    let id: string | undefined,
      roomId = "sandbox",
      messages = 0;
    let closed = false;
    const rate = setInterval(() => (messages = 0), 1000);
    const timeout = setTimeout(() => {
      if (!id) ws.close(1008, "Join timeout");
    }, 10000);
    const queue = createSignalQueue<string>(
      async (raw) => {
        const m = JSON.parse(raw);
        if (m.type === "join" && !id) {
          const nextId = randomUUID();
          let identity: Identity = { roomId: "sandbox", userId: nextId };
          if (auth) {
            if (typeof m.ticket !== "string")
              throw new Error("Ticket required");
            identity = await auth.claim(actor, m.ticket, nextId);
          } else if (peers.size >= 6) {
            send(ws, { type: "full" });
            ws.close(1000);
            return;
          }
          if (closed) {
            if (auth) await auth.release(nextId);
            return;
          }
          id = nextId;
          roomId = identity.roomId;
          const media = {
            mic: auth ? m.mic === true : true,
            camera: auth ? m.camera === true : true,
          };
          const existing = [...peers]
            .filter(([, p]) => p.roomId === roomId)
            .map(([id, p]) => ({
              id,
              userId: p.userId,
              name: p.name,
              ...p.media,
            }));
          peers.set(id, {
            ws,
            alive: true,
            roomId,
            userId: identity.userId,
            name: identity.name,
            actor,
            media,
          });
          clearTimeout(timeout);
          send(ws, { type: "welcome", id, peers: existing });
          broadcast(
            roomId,
            {
              type: "joined",
              id,
              userId: identity.userId,
              name: identity.name,
              ...media,
            },
            id,
          );
        } else if (
          id &&
          m.type === "signal" &&
          typeof m.to === "string" &&
          m.data &&
          typeof m.data === "object" &&
          ["description", "candidate"].some((k) => k in m.data)
        ) {
          const target = peers.get(m.to);
          if (target && target.roomId === roomId) {
            if (auth && !(await auth.refresh(actor, roomId, id))) {
              ws.close(1008, "Access ended");
              return;
            }
            send(target.ws, { type: "signal", from: id, data: m.data });
          }
        } else if (
          id &&
          m.type === "media" &&
          typeof m.mic === "boolean" &&
          typeof m.camera === "boolean"
        ) {
          const p = peers.get(id);
          if (p) {
            p.media = { mic: m.mic, camera: m.camera };
            broadcast(roomId, { type: "media", id, ...p.media }, id);
          }
        }
      },
      () => {
        send(ws, {
          type: "error",
          message: "Room access unavailable or invalid message.",
        });
        ws.close(1008, "Request denied");
      },
    );
    ws.on("pong", () => {
      if (id && peers.has(id)) peers.get(id)!.alive = true;
    });
    ws.on("message", (raw) => {
      if (++messages > 150) {
        ws.close(1008, "Rate limit");
        return;
      }
      void queue.push(raw.toString());
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      closed = true;
      queue.close();
      clearInterval(rate);
      clearTimeout(timeout);
      if (id) {
        peers.delete(id);
        broadcast(roomId, { type: "left", id });
        void auth?.release(id).catch(() => {});
      }
    });
  });
  let refreshing = false;
  const reconcile = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      for (const [id, p] of peers) {
        if (auth && !(await auth.refresh(p.actor, p.roomId, id))) {
          p.ws.close(1008, "Access ended");
          continue;
        }
      }
    } finally {
      refreshing = false;
    }
  };
  const heartbeat = setInterval(() => {
    for (const p of peers.values()) {
      if (!p.alive) {
        p.ws.terminate();
        continue;
      }
      p.alive = false;
      p.ws.ping();
    }
    void reconcile();
  }, 15000);
  wss.on("close", () => clearInterval(heartbeat));
  return Object.assign(wss, {
    reconcile,
    disconnectUser: (userId: string) => {
      for (const p of peers.values())
        if (p.userId === userId) p.ws.close(1008, "Access ended");
    },
  });
}
