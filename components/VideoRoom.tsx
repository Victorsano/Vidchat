"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  ShieldCheck,
  Globe2,
  Users,
  Copy,
  Check,
  Sparkles,
  Volume2,
} from "lucide-react";
import {
  createFaceEffects,
  type FaceEffects,
  type FilterState,
} from "../lib/face-effects";
import { createSignalQueue } from "../lib/signal-queue";
import type { FaceFilter } from "../lib/face-art";
type Participant = {
  id: string;
  userId?: string;
  name?: string;
  stream?: MediaStream;
  mic: boolean;
  camera: boolean;
  status?: string;
};
type Link = {
  pc: RTCPeerConnection;
  pending: RTCIceCandidateInit[];
  offerer: boolean;
  retried: boolean;
  timer?: ReturnType<typeof setTimeout>;
};
function Tile({
  person,
  self = false,
  onReport,
  onBlock,
  onKick,
}: {
  person: Participant;
  self?: boolean;
  onReport?: () => void;
  onBlock?: () => void;
  onKick?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const el = video.current;
    const sound = audio.current;
    const media = person.stream;
    if (!media) return;
    let active = true;
    if (el) {
      el.srcObject = media;
      el.muted = true;
      void el.play().catch(() => {});
    }
    const playSound = () => {
      if (!sound || self || !media.getAudioTracks().length) return;
      if (sound.srcObject !== media) sound.srcObject = media;
      sound.muted = false;
      sound.volume = 1;
      void sound
        .play()
        .then(() => {
          if (active) setBlocked(false);
        })
        .catch(() => {
          if (active) setBlocked(true);
        });
    };
    playSound();
    media.addEventListener("addtrack", playSound);
    window.addEventListener("match-enable-audio", playSound);
    return () => {
      active = false;
      media.removeEventListener("addtrack", playSound);
      window.removeEventListener("match-enable-audio", playSound);
      if (el) {
        el.pause();
        el.srcObject = null;
      }
      if (sound) {
        sound.pause();
        sound.srcObject = null;
      }
    };
  }, [person.stream, self]);
  function enableSound() {
    const el = audio.current;
    if (el) {
      el.muted = false;
      void el
        .play()
        .then(() => setBlocked(false))
        .catch(() => setBlocked(true));
    }
  }

  return (
    <div className={`video-tile ${self ? "self" : ""}`}>
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        className={person.camera && person.stream ? "" : "hidden-video"}
      />
      {!self && <audio ref={audio} autoPlay playsInline />}
      {(!person.camera || !person.stream) && (
        <div className="avatar">
          {self ? <VideoOff size={32} /> : <Users size={32} />}
        </div>
      )}
      <span className="tile-label">
        {self
          ? "You"
          : person.name ||
            `Student ${person.id.slice(0, 4).toUpperCase()}`}{" "}
        {self && <small>• just you</small>}
      </span>
      <span className="tile-mic">
        {person.mic ? <Mic size={15} /> : <MicOff size={15} />}
      </span>
      {person.status && <span className="tile-status">{person.status}</span>}
      {!self && (
        <div className="tile-safety">
          {onReport && <button onClick={onReport}>Report</button>}
          {onBlock && <button onClick={onBlock}>Block</button>}
          {onKick && <button onClick={onKick}>Remove</button>}
        </div>
      )}
      {blocked && (
        <button className="play-audio" onClick={enableSound}>
          Tap to hear this guest
        </button>
      )}
    </div>
  );
}
export default function VideoRoom({
  roomId,
  onLeave,
  onReport,
  onBlock,
  onKick,
}: {
  roomId: string;
  onLeave: () => void;
  onReport?: (id: string, name: string) => void;
  onBlock?: (id: string, name: string) => void;
  onKick?: (id: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "joining" | "live">("idle");
  const [stream, setStream] = useState<MediaStream>();
  const [people, setPeople] = useState<Participant[]>([]);
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  const [capacity, setCapacity] = useState(6);
  const [roomTitle, setRoomTitle] = useState("Campus conversation");
  const ice = useRef<RTCIceServer[]>([]);
  const [lowData, setLowData] = useState(true);
  const [filter, setFilter] = useState<FaceFilter>("none");
  const [filterState, setFilterState] = useState<FilterState>("off");
  const [effectsAvailable, setEffectsAvailable] = useState(true);
  const effects = useRef<FaceEffects | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const socket = useRef<WebSocket | null>(null);
  const local = useRef<MediaStream | null>(null);
  const links = useRef(new Map<string, Link>());
  const attempt = useRef(0);
  const joined = useRef(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function cleanup() {
    attempt.current++;
    joined.current = false;
    clearTimeout(timeout.current);
    socket.current?.close();
    socket.current = null;
    links.current.forEach((l) => {
      clearTimeout(l.timer);
      l.pc.close();
    });
    links.current.clear();
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    effects.current?.stop();
    effects.current = null;
    setFilter("none");
    setFilterState("off");
    setStream(undefined);
    setPeople([]);
    setPhase("idle");
    setElapsed(0);
  }
  useEffect(
    () => () => {
      attempt.current++;
      socket.current?.close();
      links.current.forEach((l) => {
        clearTimeout(l.timer);
        l.pc.close();
      });
      local.current?.getTracks().forEach((t) => t.stop());
      effects.current?.stop();
      clearTimeout(timeout.current);
    },
    [],
  );
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  function send(data: unknown) {
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify(data));
  }
  function update(id: string, patch: Partial<Participant>) {
    setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function makePeer(id: string, offerer = false) {
    const pc = new RTCPeerConnection({ iceServers: ice.current });
    const link: Link = { pc, pending: [], offerer, retried: false };
    links.current.set(id, link);
    if (offerer)
      for (const kind of ["audio", "video"] as const) {
        const track = local.current!.getTracks().find((t) => t.kind === kind);
        pc.addTransceiver(track || kind, {
          direction: "sendrecv",
          streams: [local.current!],
        });
      }
    pc.onicecandidate = (e) => {
      if (e.candidate)
        send({
          type: "signal",
          to: id,
          data: { candidate: e.candidate.toJSON() },
        });
    };
    pc.ontrack = (e) => {
      const remote = e.streams[0];
      if (remote) update(id, { stream: remote });
    };
    const checkConnection = () => {
      if (links.current.get(id) !== link) return;
      if (pc.connectionState === "connected") {
        clearTimeout(link.timer);
        link.timer = undefined;
        update(id, { status: undefined });
      } else if (
        pc.connectionState === "failed" ||
        pc.iceConnectionState === "failed"
      ) {
        clearTimeout(link.timer);
        link.timer = undefined;
        update(id, { status: "Could not connect · leave and rejoin" });
        if (link.offerer && !link.retried && pc.signalingState === "stable") {
          link.retried = true;
          update(id, { status: "Retrying connection…" });
          void (async () => {
            await pc.setLocalDescription(
              await pc.createOffer({ iceRestart: true }),
            );
            send({
              type: "signal",
              to: id,
              data: { description: pc.localDescription },
            });
          })().catch(() =>
            update(id, { status: "Could not reconnect · leave and rejoin" }),
          );
        }
      } else if (pc.connectionState === "disconnected")
        update(id, { status: "Reconnecting…" });
    };
    pc.onconnectionstatechange = checkConnection;
    pc.oniceconnectionstatechange = checkConnection;
    link.timer = setTimeout(() => {
      if (pc.connectionState !== "connected")
        update(id, { status: "Still connecting · check your network" });
    }, 18000);

    return link;
  }
  async function join() {
    setError("");
    setPhase("joining");
    const current = ++attempt.current;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Camera access needs HTTPS (or localhost). See the testing guide.",
        );
      const ticketResponse = await fetch(`/api/rooms/${roomId}/join-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const admission = await ticketResponse.json();
      if (!ticketResponse.ok)
        throw new Error(admission.error?.message || "Room access denied.");
      ice.current = admission.iceServers;
      setCanModerate(admission.canModerate);
      setCapacity(admission.capacity);
      setRoomTitle(admission.title);
      const media =
        mic || camera
          ? await navigator.mediaDevices.getUserMedia({
              audio: mic
                ? { echoCancellation: true, noiseSuppression: true }
                : false,
              video: camera
                ? {
                    width: { ideal: lowData ? 320 : 640 },
                    height: { ideal: lowData ? 180 : 360 },
                    frameRate: { ideal: lowData ? 15 : 24, max: 24 },
                    facingMode: "user",
                  }
                : false,
            })
          : new MediaStream();
      if (current !== attempt.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      local.current = media;
      if (camera) {
        const pipeline = await createFaceEffects(media, (state) => {
          if (current === attempt.current) setFilterState(state);
        });
        if (current !== attempt.current) {
          pipeline.stop();
          return;
        }
        effects.current = pipeline;
        setEffectsAvailable(pipeline.available);
        local.current = pipeline.stream;
      }
      setStream(local.current);
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/signal`,
      );
      socket.current = ws;
      timeout.current = setTimeout(() => {
        if (current === attempt.current) {
          cleanup();
          setError("The room took too long to respond. Please try again.");
        }
      }, 12000);
      ws.onopen = () =>
        send({ type: "join", ticket: admission.ticket, mic, camera });
      const queue = createSignalQueue<string>(
        async (raw) => {
          if (current !== attempt.current) return;
          const m = JSON.parse(raw);
          if (m.type === "welcome") {
            clearTimeout(timeout.current);
            joined.current = true;
            setPhase("live");
            setPeople(
              m.peers.map((p: Participant) => ({
                ...p,
                status: "Connecting…",
              })),
            );
            for (const p of m.peers) {
              const { pc } = makePeer(p.id, true);
              await pc.setLocalDescription(await pc.createOffer());
              send({
                type: "signal",
                to: p.id,
                data: { description: pc.localDescription },
              });
            }
          } else if (m.type === "joined") {
            setPeople((ps) => [
              ...ps,
              {
                id: m.id,
                userId: m.userId,
                name: m.name,
                mic: m.mic,
                camera: m.camera,
                status: "Connecting…",
              },
            ]);
          } else if (m.type === "left") {
            clearTimeout(links.current.get(m.id)?.timer);
            links.current.get(m.id)?.pc.close();
            links.current.delete(m.id);
            setPeople((ps) => ps.filter((p) => p.id !== m.id));
          } else if (m.type === "media")
            update(m.id, { mic: m.mic, camera: m.camera });
          else if (m.type === "error") {
            setError(m.message || "Room access ended.");
            cleanup();
          } else if (m.type === "full") {
            cleanup();
            setError("The room is full. Try again in a moment.");
          } else if (m.type === "signal") {
            const link = links.current.get(m.from) || makePeer(m.from);
            const { pc } = link;
            if (m.data.description) {
              await pc.setRemoteDescription(m.data.description);
              for (const c of link.pending) await pc.addIceCandidate(c);
              link.pending = [];
              if (m.data.description.type === "offer") {
                for (const transceiver of pc.getTransceivers()) {
                  const track =
                    local
                      .current!.getTracks()
                      .find(
                        (t) => t.kind === transceiver.receiver.track.kind,
                      ) || null;
                  await transceiver.sender.replaceTrack(track);
                  transceiver.sender.setStreams(local.current!);
                  transceiver.direction = "sendrecv";
                }
                await pc.setLocalDescription(await pc.createAnswer());
                send({
                  type: "signal",
                  to: m.from,
                  data: { description: pc.localDescription },
                });
              }
            } else if (m.data.candidate) {
              if (pc.remoteDescription)
                await pc.addIceCandidate(m.data.candidate);
              else link.pending.push(m.data.candidate);
            }
          }
        },
        () => {
          if (current === attempt.current)
            setError("A peer could not connect. Leave and rejoin to retry.");
        },
      );
      ws.onmessage = (event) => {
        void queue.push(event.data);
      };
      ws.onclose = () => {
        queue.close();
        if (current !== attempt.current) return;
        const wasJoined = joined.current;
        cleanup();
        setError(
          wasJoined
            ? "Connection to the room was lost. Join again to reconnect."
            : "Could not connect to the room. Please try again.",
        );
      };
      ws.onerror = () => ws.close();
    } catch (e) {
      if (current !== attempt.current) return;
      cleanup();
      setError(
        e instanceof DOMException
          ? e.name === "NotAllowedError"
            ? "Camera and microphone permission is needed. Allow access in your browser, then try again."
            : e.name === "NotFoundError"
              ? "The selected device was not found. Connect it or enter with that device off."
              : `Could not start your devices: ${e.message}`
          : e instanceof Error
            ? e.message
            : "Unable to join. Please try again.",
      );
    }
  }
  async function toggle(kind: "mic" | "camera") {
    const next = kind === "mic" ? !mic : !camera;
    const mediaKind = kind === "mic" ? "audio" : "video";
    try {
      if (
        phase === "live" &&
        next &&
        !local.current?.getTracks().some((t) => t.kind === mediaKind)
      ) {
        const added = await navigator.mediaDevices.getUserMedia({
          audio:
            kind === "mic"
              ? { echoCancellation: true, noiseSuppression: true }
              : false,
          video:
            kind === "camera"
              ? {
                  width: { ideal: 640 },
                  height: { ideal: 360 },
                  frameRate: { ideal: 24, max: 24 },
                  facingMode: "user",
                }
              : false,
        });
        if (!joined.current) {
          added.getTracks().forEach((t) => t.stop());
          return;
        }
        added.getTracks().forEach((t) => local.current!.addTrack(t));
        if (kind === "camera" && !effects.current) {
          const pipeline = await createFaceEffects(
            local.current!,
            setFilterState,
          );
          effects.current = pipeline;
          local.current = pipeline.stream;
          setEffectsAvailable(pipeline.available);
        }
        const track = local
          .current!.getTracks()
          .find((t) => t.kind === mediaKind)!;
        for (const l of links.current.values()) {
          const transceiver = l.pc
            .getTransceivers()
            .find((t) => t.receiver.track.kind === mediaKind);
          await transceiver?.sender.replaceTrack(track);
        }
        setStream(new MediaStream(local.current!.getTracks()));
      }
      local.current
        ?.getTracks()
        .filter((t) => t.kind === mediaKind)
        .forEach((t) => (t.enabled = next));
      if (kind === "mic") setMic(next);
      else {
        setCamera(next);
        effects.current?.setCamera(next);
      }
      send({
        type: "media",
        mic: kind === "mic" ? next : mic,
        camera: kind === "camera" ? next : camera,
      });
    } catch {
      setError(
        "Device access was denied or unavailable. Your existing call remains connected.",
      );
    }
  }
  function selectFilter(value: FaceFilter) {
    setFilter(value);
    effects.current?.setFilter(value);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/live`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy the address from your browser to invite someone.");
    }
  }
  return (
    <div className="rtc-surface">
      <button
        className="dm-back"
        onClick={() => {
          cleanup();
          onLeave();
        }}
      >
        ← Back to rooms
      </button>{" "}
      <section
        className={`room ${phase === "live" ? "in-call" : ""}`}
        aria-label="Shared video room"
      >
        <div className="room-top">
          <div>
            <span className="room-icon">
              <Globe2 size={18} />
            </span>
            <strong>{roomTitle}</strong>
            <span className="room-badge">VERIFIED</span>
          </div>
          <span className="room-count">
            <Users size={15} />
            {phase === "live"
              ? `${people.length + 1} / ${capacity} in room`
              : "Small-group room"}
          </span>
        </div>
        {phase !== "live" ? (
          <div className="lobby">
            <div className="orbital">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <span className="floating-dot dot-one" />
              <span className="floating-dot dot-two" />
              <div className="video-symbol">
                <Video size={39} strokeWidth={1.7} />
                <span className="spark">
                  <Sparkles size={15} />
                </span>
              </div>
            </div>
            <h2>Good conversations start with hello.</h2>
            <p>Choose your devices. Nothing transmits before you enter.</p>
            <div className="rtc-lobby-choices">
              <button aria-pressed={mic} onClick={() => void toggle("mic")}>
                {mic ? <Mic /> : <MicOff />} Mic {mic ? "on" : "off"}
              </button>
              <button
                aria-pressed={camera}
                onClick={() => void toggle("camera")}
              >
                {camera ? <Video /> : <VideoOff />} Camera{" "}
                {camera ? "on" : "off"}
              </button>
            </div>
            <label className="rtc-low-data">
              <input
                type="checkbox"
                checked={lowData}
                onChange={(e) => setLowData(e.target.checked)}
              />{" "}
              Low-data mode
            </label>
            <button
              className="join"
              onClick={join}
              disabled={phase === "joining"}
            >
              {phase === "joining" ? (
                <>
                  <span className="spinner" />
                  Connecting…
                </>
              ) : (
                <>
                  Enter room <ArrowRight size={18} />
                </>
              )}
            </button>
            {phase === "joining" && (
              <button className="cancel" onClick={cleanup}>
                Cancel
              </button>
            )}
            <div className="permission-note">
              <ShieldCheck size={14} /> Only the devices you select will request
              permission
            </div>
          </div>
        ) : (
          <>
            <div className="call-meta">
              <span>
                <span className="live-dot" /> LIVE{" "}
                <b>
                  {Math.floor(elapsed / 60)
                    .toString()
                    .padStart(2, "0")}
                  :{(elapsed % 60).toString().padStart(2, "0")}
                </b>
              </span>
              <button onClick={copy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
                {copied ? "Copied" : "Invite someone"}
              </button>
            </div>
            <div className={`video-grid ${people.length === 0 ? "solo" : ""}`}>
              <Tile person={{ id: "you", stream, mic, camera }} self />
              {people.map((p) => (
                <Tile
                  key={p.id}
                  person={p}
                  onReport={
                    p.userId && onReport
                      ? () => onReport(p.userId!, p.name || "Student")
                      : undefined
                  }
                  onBlock={
                    p.userId && onBlock
                      ? () => onBlock(p.userId!, p.name || "Student")
                      : undefined
                  }
                  onKick={
                    canModerate && p.userId && onKick
                      ? () => onKick(p.userId!)
                      : undefined
                  }
                />
              ))}
              {people.length === 0 && (
                <div className="waiting">
                  <div>
                    <Users size={28} />
                  </div>
                  <h3>You’re the first one here.</h3>
                  <p>A little company is one link away.</p>
                  <button onClick={copy}>
                    {copied ? "Link copied" : "Copy invite link"}{" "}
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              )}
            </div>
            <div className="filters" aria-label="Face filters">
              <div className="filters-heading">
                <span>
                  <Sparkles size={14} /> Face filters
                </span>
                <small role="status" aria-live="polite">
                  {!effectsAvailable
                    ? "Filters aren’t supported in this browser"
                    : !camera
                      ? "Turn on your camera to use filters"
                      : filterState === "loading"
                        ? "Loading filters…"
                        : filterState === "searching"
                          ? "Look toward the camera"
                          : filterState === "tracking"
                            ? "Your filter is live"
                            : filterState === "unavailable"
                              ? "Couldn’t load filters. Try another option."
                              : "A little extra personality."}
                </small>
              </div>
              <div className="filter-options">
                {(
                  [
                    { id: "none", icon: "○", label: "None" },
                    { id: "bunny", icon: "🐰", label: "Bunny ears" },
                    { id: "mask", icon: "😷", label: "Nose mask" },
                    { id: "patch", icon: "🏴‍☠️", label: "Eye patch" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={filter === item.id}
                    disabled={
                      item.id !== "none" && (!camera || !effectsAvailable)
                    }
                    className={filter === item.id ? "selected" : ""}
                    onClick={() => selectFilter(item.id)}
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="controls">
              <div className="control-group">
                <button
                  className={!mic ? "off" : ""}
                  onClick={() => toggle("mic")}
                  aria-label={mic ? "Mute microphone" : "Unmute microphone"}
                  aria-pressed={!mic}
                >
                  {mic ? <Mic size={20} /> : <MicOff size={20} />}
                </button>
                <button
                  className={!camera ? "off" : ""}
                  onClick={() => toggle("camera")}
                  aria-label={camera ? "Turn camera off" : "Turn camera on"}
                  aria-pressed={!camera}
                >
                  {camera ? <Video size={20} /> : <VideoOff size={20} />}
                </button>
              </div>
              <button
                className="enable-sound"
                onClick={() =>
                  window.dispatchEvent(new Event("match-enable-audio"))
                }
              >
                <Volume2 size={16} /> Enable sound
              </button>
              <button className="leave" onClick={cleanup}>
                <PhoneOff size={18} />
                <span>Leave Call</span>
              </button>
            </div>
          </>
        )}
        <div className="room-bottom">
          <span>
            <span className="live-dot" />{" "}
            {phase === "live" ? "You’re connected" : "Pre-call lobby"}
          </span>
          <span>
            <ShieldCheck size={13} /> Peer-to-peer connection
          </span>
        </div>
      </section>
      {error && (
        <div className="error" role="alert">
          {error}
          <button aria-label="Dismiss message" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
