"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  MotionConfig,
  useReducedMotion,
} from "motion/react";
import {
  Compass,
  Video,
  MessageCircle,
  Users,
  Heart,
  Search,
  SlidersHorizontal,
  Sparkles,
  ArrowUpRight,
  ArrowLeft,
  X,
  Check,
  ShieldCheck,
  BookOpen,
  Music,
  Camera,
  Send,
  Bell,
  Flag,
  LogOut,
  Lock,
  Plus,
  Settings,
} from "lucide-react";
import VideoRoom from "./VideoRoom";
type Person = {
  id: string;
  name: string;
  bio: string;
  interests: string[];
  modes: string[];
  age?: number;
  department?: string;
  year?: string;
  photos: string[];
};
type Me = {
  id: string;
  email: string;
  status: string;
  role: string;
  profile: any;
  photos: { id: string; status: string }[];
};
type Room = {
  id: string;
  title: string;
  topic: string;
  kind: string;
  capacity: number;
  count: number;
  canModerate: boolean;
};
const modes = [
  ["friends", "Friends", Users],
  ["dating", "Dating 18+", Heart],
  ["study", "Study", BookOpen],
] as const;
const tabs = [
  ["Discover", Compass, "/discover"],
  ["Live", Video, "/live"],
  ["Chats", MessageCircle, "/chats"],
  ["Campus", Users, "/campus"],
] as const;
function Portrait({
  person,
  className = "",
}: {
  person: Person;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return person.photos?.[0] && !failed ? (
    <img
      className={className}
      src={person.photos[0]}
      alt={person.name}
      onError={() => setFailed(true)}
    />
  ) : (
    <span className={"real-avatar " + className} aria-label={person.name}>
      {person.name?.slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}
function PersonButton({ p, open }: { p: Person; open: () => void }) {
  return (
    <div className="dm-person">
      <button
        className="dm-person-photo"
        onClick={open}
        aria-label={`View ${p.name}`}
      >
        <Portrait person={p} />
        <span className="dm-person-shade" />
        <div>
          <strong>
            {p.name}
            {p.age ? `, ${p.age}` : ""}
          </strong>
          <small>{p.department || p.interests.slice(0, 2).join(" · ")}</small>
        </div>
      </button>
      <div className="dm-person-foot">
        <span>{p.interests.slice(0, 2).join(" · ")}</span>
        <button onClick={open} aria-label={`Read ${p.name}'s profile`}>
          <ArrowUpRight size={18} />
        </button>
      </div>
    </div>
  );
}
export default function DorcasClient() {
  const [route, setRoute] = useState("/"),
    [me, setMe] = useState<Me | null>(null),
    [boot, setBoot] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [sent, setSent] = useState(false),
    [cooldown, setCooldown] = useState(0),
    [mode, setMode] = useState("friends"),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("People"),
    [people, setPeople] = useState<Person[]>([]),
    [nextCursor, setNextCursor] = useState<string | null>(null),
    [rooms, setRooms] = useState<Room[]>([]),
    [conversations, setConversations] = useState<any[]>([]),
    [invitations, setInvitations] = useState<any[]>([]),
    [thread, setThread] = useState<any>(null),
    [messages, setMessages] = useState<any[]>([]),
    [draft, setDraft] = useState(""),
    [sheet, setSheet] = useState<any>(null),
    [campus, setCampus] = useState<any>({ groups: [], events: [] }),
    [group, setGroup] = useState<any>(null),
    [posts, setPosts] = useState<any[]>([]),
    [postDraft, setPostDraft] = useState(""),
    [form, setForm] = useState<any>({
      display_name: "",
      bio: "",
      interests: [],
      modes: [],
      paused: true,
      show_age: false,
      show_department: false,
      department: "",
      year_level: "",
      age_min: 18,
      age_max: 65,
    }),
    [birth, setBirth] = useState(""),
    [terms, setTerms] = useState(false),
    [queue, setQueue] = useState<any>({ state: "idle" }),
    [roomTitle, setRoomTitle] = useState(""),
    [roomTopic, setRoomTopic] = useState("friends"),
    [roomCapacity, setRoomCapacity] = useState(4),
    [reportCategory, setReportCategory] = useState("harassment"),
    [reportText, setReportText] = useState(""),
    [review, setReview] = useState<any>(null),
    [reviewReason, setReviewReason] = useState(""),
    [independentReview, setIndependentReview] = useState(false),
    [reaction, setReaction] = useState(""),
    [blocked, setBlocked] = useState<any[]>([]),
    [confirmDelete, setConfirmDelete] = useState(""),
    [loading, setLoading] = useState(false);
  const [moderatorLogin, setModeratorLogin] = useState(false),
    [totp, setTotp] = useState("");
  const nonce = useRef<{ text: string; id: string } | null>(null),
    end = useRef<HTMLDivElement>(null),
    reduced = useReducedMotion();
  const page = route.startsWith("/call/")
    ? "Call"
    : route.startsWith("/admin")
      ? "Moderation"
      : route === "/me"
        ? "Profile"
        : route.startsWith("/live")
          ? "Live"
          : route.startsWith("/chats")
            ? "Chats"
            : route.startsWith("/campus")
              ? "Campus"
              : route === "/discover/swipe"
                ? "SwipeChat"
                : "Discover";
  const notify = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(""), 3500);
  };
  const api = useCallback(
    async (path: string, method = "GET", data?: unknown) => {
      const r = await fetch("/api/" + path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers:
          method !== "GET" ? { "Content-Type": "application/json" } : undefined,
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      let value: any;
      try {
        value = await r.json();
      } catch {
        throw new Error(
          "The server returned an unreadable response. Please retry.",
        );
      }
      if (!r.ok) {
        if (r.status === 401) setMe(null);
        throw new Error(
          value.error?.message || "The request could not be completed.",
        );
      }
      return value;
    },
    [],
  );
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The request failed. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  };
  const go = (path: string) => {
    if (sheet?.type === "quick")
      void api("quick-match/cancel", "POST", {}).catch(() => {});
    history.pushState(null, "", path);
    setRoute(path);
    setSheet(null);
    setThread(null);
    setError("");
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const refreshMe = useCallback(async () => {
    const user = await api("me");
    setMe(user);
    return user;
  }, [api]);
  useEffect(() => {
    setRoute(location.pathname);
    const pop = () => {
      setRoute(location.pathname);
      setSheet(null);
      setThread(null);
    };
    addEventListener("popstate", pop);
    void refreshMe()
      .catch((e) => {
        if (!e.message.includes("sign in") && !e.message.includes("session"))
          setError(e.message);
      })
      .finally(() => setBoot(false));
    return () => removeEventListener("popstate", pop);
  }, [refreshMe]);
  useEffect(() => {
    if (me)
      setForm({
        ...me.profile,
        interests: me.profile.interests || [],
        modes: me.profile.modes || [],
      });
  }, [me?.id]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  const loadDiscover = useCallback(async () => {
    if (me?.status !== "active") return;
    setLoading(true);
    try {
      const result = await api(`discover?mode=${mode}`);
      setPeople(result.profiles);
      setNextCursor(result.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, mode, me?.id, me?.status]);
  const loadRooms = useCallback(async () => {
    if (me?.status === "active") setRooms(await api("rooms"));
  }, [api, me?.id, me?.status]);
  const loadConversations = useCallback(async () => {
    if (me?.status === "active") setConversations(await api("conversations"));
  }, [api, me?.id, me?.status]);
  const loadCampus = useCallback(async () => {
    if (me?.status === "active") setCampus(await api("campus"));
  }, [api, me?.id, me?.status]);
  useEffect(() => {
    if (me?.status !== "active") return;
    void loadDiscover();
    void loadRooms().catch((e) => setError(e.message));
    void loadConversations().catch((e) => setError(e.message));
    void loadCampus().catch((e) => setError(e.message));
    const t = setInterval(() => {
      if (document.hidden) return;
      void api("call-invitations")
        .then(setInvitations)
        .catch(() => {});
      void loadConversations().catch(() => {});
      void loadRooms().catch(() => {});
      void refreshMe().catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [
    me?.id,
    me?.status,
    loadDiscover,
    loadRooms,
    loadConversations,
    loadCampus,
    api,
    refreshMe,
  ]);
  useEffect(() => {
    if (!thread) return;
    let live = true;
    const load = () =>
      api(`conversations/${thread.id}/messages`)
        .then((data) => {
          if (live) setMessages(data);
        })
        .catch((e) => {
          if (live) {
            setError(e.message);
            setThread(null);
          }
        });
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [thread?.id, api]);
  useEffect(() => {
    end.current?.scrollIntoView({
      behavior: reduced ? "instant" : "smooth",
      block: "nearest",
    });
  }, [messages.length, reduced]);
  useEffect(() => {
    if (sheet?.type !== "quick" || queue.state === "idle") return;
    let live = true;
    const poll = () =>
      api("quick-match/status")
        .then((q) => {
          if (live) setQueue(q);
        })
        .catch((e) => {
          if (live) {
            setQueue({ state: "idle" });
            setError(e.message);
          }
        });
    void poll();
    const t = setInterval(() => void poll(), 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [sheet?.type, queue.state === "idle", api]);
  useEffect(() => {
    if (!group) return;
    void api(`groups/${group.id}/posts`)
      .then(setPosts)
      .catch((e) => setError(e.message));
  }, [group?.id, api]);
  useEffect(() => {
    if (!sheet) return;
    const old = document.activeElement as HTMLElement | null;
    const timer = setTimeout(
      () =>
        document.querySelector<HTMLButtonElement>(".dm-sheet-close")?.focus(),
      60,
    );
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (sheet.type === "quick")
          void api("quick-match/cancel", "POST", {}).catch(() => {});
        setSheet(null);
      }
      if (e.key === "Tab") {
        const els = [
          ...document.querySelectorAll<HTMLElement>(
            ".dm-sheet button,.dm-sheet input,.dm-sheet select,.dm-sheet textarea",
          ),
        ].filter((e) => !(e as HTMLButtonElement).disabled);
        if (e.shiftKey && document.activeElement === els[0]) {
          e.preventDefault();
          els.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
          e.preventDefault();
          els[0]?.focus();
        }
      }
    };
    addEventListener("keydown", key);
    return () => {
      clearTimeout(timer);
      removeEventListener("keydown", key);
      old?.focus();
    };
  }, [sheet?.type, api]);
  const filtered = people.filter((p) =>
    `${p.name} ${p.interests.join(" ")} ${p.department || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  async function choose(p: Person, decision: "like" | "pass") {
    await act(async () => {
      const r = await api(`swipes/${p.id}`, "PUT", { mode, decision });
      setPeople((ps) => ps.filter((x) => x.id !== p.id));
      if (r.matched) {
        setSheet({
          type: "matched",
          person: p,
          conversationId: r.conversationId,
        });
        await loadConversations();
      } else if (decision === "like") {
        setReaction("A little spark sent.");
        setTimeout(() => setReaction(""), 1400);
      } else {
        setReaction("A new possibility awaits.");
        setTimeout(() => setReaction(""), 1100);
      }
    });
  }
  async function saveProfile() {
    await act(async () => {
      const data = {
        display_name: form.display_name,
        bio: form.bio,
        department: form.department,
        year_level: form.year_level,
        interests: form.interests,
        modes: form.modes,
        paused: form.paused,
        show_age: form.show_age,
        show_department: form.show_department,
        age_min: Number(form.age_min),
        age_max: Number(form.age_max),
        ...(birth ? { birthDate: birth, termsAccepted: terms } : {}),
      };
      await api("me", "PATCH", data);
      await refreshMe();
      notify("Profile saved. Public changes may require review.");
      setBirth("");
    });
  }
  async function upload(file: File) {
    await act(async () => {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Choose an image smaller than 5 MB.");
      const r = await fetch("/api/me/photos", {
        method: "POST",
        body: file,
        headers: { "Content-Type": file.type },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || "Upload failed.");
      await refreshMe();
      notify("Photo received for moderator review.");
    });
  }
  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!thread || !draft.trim()) return;
    await act(async () => {
      if (nonce.current?.text !== draft.trim())
        nonce.current = { text: draft.trim(), id: crypto.randomUUID() };
      const result = await api(`conversations/${thread.id}/messages`, "POST", {
        body: nonce.current.text,
        nonce: nonce.current.id,
      });
      setMessages((ms) =>
        ms.some((m) => m.id === result.id) ? ms : [...ms, result],
      );
      setDraft("");
      nonce.current = null;
      await loadConversations();
    });
  }
  function roomCard(room: Room) {
    const Icon =
      room.topic === "study"
        ? BookOpen
        : room.topic === "music"
          ? Music
          : Users;
    return (
      <button
        className={
          "dm-room " +
          (room.topic === "study"
            ? "sage"
            : room.topic === "music"
              ? "clay"
              : "mauve")
        }
        onClick={() => go("/call/" + room.id)}
        key={room.id}
      >
        <div className="dm-room-top">
          <span className="dm-room-icon">
            <Icon size={23} />
          </span>
          <span className="dm-sample">
            {room.count}/{room.capacity} IN ROOM
          </span>
        </div>
        <h3>{room.title}</h3>
        <p>
          {room.kind === "public"
            ? "A verified-student space."
            : "Private, accepted participants only."}
        </p>
        <div className="dm-room-tags">
          <span>{room.topic}</span>
          <span>Audio-only welcome</span>
        </div>
        <div className="dm-room-bottom">
          <span>
            {room.count >= room.capacity
              ? "Full · try later"
              : "Choose devices in the lobby"}
          </span>
          <ArrowUpRight size={17} />
        </div>
      </button>
    );
  }
  function closeSheet() {
    if (sheet?.type === "quick")
      void api("quick-match/cancel", "POST", {}).catch(() => {});
    setSheet(null);
  }
  const mine: Person = {
    id: me?.id || "",
    name: me?.profile.display_name || "You",
    bio: me?.profile.bio || "",
    interests: me?.profile.interests || [],
    modes: me?.profile.modes || [],
    photos:
      me?.photos
        .filter((p) => p.status === "approved")
        .map((p) => "/api/photos/" + p.id) || [],
  };
  return (
    <MotionConfig reducedMotion="user">
      <div
        className={`dorcas-app dm-page-${page.toLowerCase()} ${!me ? "signed-out" : ""}`}
      >
        <div className="soil-backdrop dm-soil" aria-hidden="true">
          <div className="soil-landscape" />
          <div className="soil-light" />
        </div>
        <div className="dm-shell">
          <header className="dm-header">
            <button
              className="dm-brand"
              onClick={() => go("/discover")}
              aria-label="Dorcas Match home"
            >
              <span className="dm-mark">
                dm
                <span />
              </span>
              <span>
                dorcas<span>match</span>
              </span>
            </button>
            {me?.status === "active" && (
              <div className="dm-desktop-nav">
                {tabs.map(([label, Icon, path]) => (
                  <button
                    className={page === label ? "selected" : ""}
                    key={path}
                    onClick={() => go(path)}
                  >
                    <Icon size={17} />
                    {label}
                  </button>
                ))}
              </div>
            )}
            <span className="dm-demo-label">STUDENT BETA</span>
            {me?.status === "active" && (
              <button
                className="dm-header-icon"
                aria-label="Call invitations"
                onClick={() =>
                  void act(async () => {
                    setInvitations(await api("call-invitations"));
                    setSheet({ type: "invitations" });
                  })
                }
              >
                <Bell size={20} />
                {invitations.filter(
                  (i) => i.status === "pending" && i.recipient_id === me.id,
                ).length > 0 && <i className="real-unread" />}
              </button>
            )}
            {me && (
              <button
                className="dm-avatar"
                aria-label="My profile"
                onClick={() => go("/me")}
              >
                <Portrait person={mine} />
              </button>
            )}
          </header>
          {error && (
            <div className="real-error" role="alert">
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={18} />
              </button>
            </div>
          )}
          {boot ? (
            <main className="dm-main">
              <div className="real-loading" role="status">
                Getting your space ready…
              </div>
            </main>
          ) : !me ? (
            <main className="dm-main">
              <section className="real-auth">
                <span className="dm-kicker">BABCOCK STUDENTS · 18+</span>
                <h1>
                  Your campus.
                  <br />
                  Your kind of <em>people.</em>
                </h1>
                <p>A shared interest. A new friend. A real conversation.</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      if (sent) {
                        await api("auth/verify", "POST", {
                          email,
                          code,
                          ...(moderatorLogin ? { totp } : {}),
                        });
                        await refreshMe();
                        setCode("");
                        setSent(false);
                        go("/discover");
                      } else {
                        await api("auth/start", "POST", { email });
                        setSent(true);
                        setCooldown(60);
                      }
                    });
                  }}
                >
                  <label>
                    Student email
                    <input
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      readOnly={sent}
                      placeholder="you@student.babcock.edu.ng"
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  {sent && (
                    <label>
                      Six-digit code
                      <input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                        value={code}
                        onChange={(e) =>
                          setCode(e.target.value.replace(/\D/g, ""))
                        }
                      />
                    </label>
                  )}
                  {sent && (
                    <>
                      <label className="real-checkbox">
                        <input
                          type="checkbox"
                          checked={moderatorLogin}
                          onChange={(e) => setModeratorLogin(e.target.checked)}
                        />
                        Moderator sign-in
                      </label>
                      {moderatorLogin && (
                        <label>
                          Authenticator security code
                          <input
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            maxLength={6}
                            required
                            value={totp}
                            onChange={(e) =>
                              setTotp(e.target.value.replace(/\D/g, ""))
                            }
                          />
                        </label>
                      )}
                    </>
                  )}
                  <button className="dm-primary" disabled={busy}>
                    {busy
                      ? "Please wait…"
                      : sent
                        ? "Verify email"
                        : "Send verification code"}
                    <ArrowUpRight size={18} />
                  </button>
                </form>
                {sent && (
                  <>
                    <button
                      className="dm-text-button"
                      disabled={cooldown > 0 || busy}
                      onClick={() =>
                        void act(async () => {
                          await api("auth/start", "POST", { email });
                          setCooldown(60);
                          notify("A new code has been requested.");
                        })
                      }
                    >
                      {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                    </button>
                    <button
                      className="dm-text-button"
                      onClick={() => {
                        setSent(false);
                        setCode("");
                      }}
                    >
                      Use another email
                    </button>
                  </>
                )}
                <div className="dm-consent">
                  <ShieldCheck size={15} />
                  <span>
                    Mailbox verification, then independent adult-eligibility
                    review.
                  </span>
                </div>
                <p className="dm-small-print">
                  Private student profiles, chats, and rooms are never shown
                  before activation. Independent student project; no university
                  endorsement.
                </p>
                <button
                  className="dm-text-button"
                  onClick={() => setSheet({ type: "privacy" })}
                >
                  Privacy & safety information
                </button>
              </section>
            </main>
          ) : me.status !== "active" ? (
            <main className="dm-main">
              <section className="real-onboarding">
                <span className="dm-kicker">A LITTLE ABOUT YOU</span>
                <h1>
                  {me.status === "review"
                    ? "You’re in review."
                    : "Make yourself at home."}
                </h1>
                <p>
                  {me.status === "review"
                    ? "Your mailbox is verified. A moderator must independently review adult eligibility and your profile before activation."
                    : "Your email is verified. Complete a private adult-eligibility submission and a profile. No checkbox alone activates an account."}
                </p>
                {profileFields()}
                <div className="real-private-fields">
                  <h3>Private eligibility information</h3>
                  <label>
                    Date of birth
                    {me.status === "review" && (
                      <small>
                        {" "}
                        Already submitted; only enter to correct it.
                      </small>
                    )}
                    <input
                      type="date"
                      value={birth}
                      onChange={(e) => setBirth(e.target.value)}
                      max={new Date().toISOString().slice(0, 10)}
                    />
                  </label>
                  <label className="real-checkbox">
                    <input
                      type="checkbox"
                      checked={terms}
                      onChange={(e) => setTerms(e.target.checked)}
                    />
                    I accept the Terms and Privacy notice and request an
                    adult-eligibility review.
                  </label>
                  <button
                    className="dm-text-button"
                    onClick={() => setSheet({ type: "privacy" })}
                  >
                    Read Terms & Privacy notice
                  </button>
                </div>
                <button
                  className="dm-primary"
                  disabled={
                    busy ||
                    (!birth && me.status === "onboarding") ||
                    (birth !== "" && !terms)
                  }
                  onClick={() => void saveProfile()}
                >
                  {busy ? "Saving…" : "Save and submit for review"}
                </button>
                <button
                  className="dm-text-button"
                  onClick={() =>
                    void act(async () => {
                      await refreshMe();
                      notify("Account status refreshed.");
                    })
                  }
                >
                  Check review status
                </button>
                {photoManager()}
                <button
                  className="dm-text-button"
                  onClick={() =>
                    void act(async () => {
                      await api("auth/logout", "POST", { all: false });
                      setMe(null);
                    })
                  }
                >
                  Sign out
                </button>
              </section>
            </main>
          ) : (
            <>
              <main className="dm-main">
                <motion.div
                  className={
                    "dm-screen " + (page === "Chats" ? "real-chat-screen" : "")
                  }
                  key={route}
                  initial={{ opacity: 0, y: reduced ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduced ? 0 : 0.25 }}
                >
                  {page === "Discover" && (
                    <>
                      <div className="dm-greeting">
                        <span className="dm-kicker">
                          YOUR CAMPUS. YOUR KIND OF PEOPLE.
                        </span>
                        <h1>
                          Good company starts
                          <br />
                          with a little <em>hello.</em>
                        </h1>
                        <p>Hey {mine.name}. Make room for a new connection.</p>
                      </div>
                      <div className="dm-search-row">
                        <label className="dm-search">
                          <Search size={18} />
                          <input
                            aria-label="Search people or room topics"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="A name, an interest, a shared thing…"
                          />
                          {query && (
                            <button
                              aria-label="Clear search"
                              onClick={() => setQuery("")}
                            >
                              <X size={16} />
                            </button>
                          )}
                        </label>
                        <button
                          className="dm-filter"
                          aria-label="Discovery preferences"
                          onClick={() => setSheet({ type: "preferences" })}
                        >
                          <SlidersHorizontal size={18} />
                        </button>
                      </div>
                      <div className="dm-search-categories">
                        {["People", "Rooms"].map((t) => (
                          <button
                            className={category === t ? "selected" : ""}
                            onClick={() => setCategory(t)}
                            key={t}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                      <div className="dm-intents">
                        {modes.map(([value, label, Icon]) => (
                          <button
                            aria-pressed={mode === value}
                            className={mode === value ? "selected" : ""}
                            onClick={() => setMode(value)}
                            key={value}
                          >
                            <Icon size={15} />
                            {label}
                          </button>
                        ))}
                      </div>
                      {!me.profile.modes.includes(mode) && (
                        <p className="dm-demo-note">
                          You haven’t opted into {mode}. Change visibility in
                          your profile to participate.
                        </p>
                      )}
                      <div className="dm-discover-grid">
                        <div className="dm-primary-column">
                          <section className="dm-hero">
                            <span className="dm-hero-orbit" />
                            <span className="dm-kicker">
                              <Sparkles size={13} />
                              REAL CONVERSATIONS, AT YOUR PACE
                            </span>
                            <h2>
                              A new face.
                              <br />A shared <em>frequency.</em>
                            </h2>
                            <p>
                              Find someone to talk to, or a room that feels like
                              you.
                            </p>
                            <div className="dm-hero-actions">
                              <button
                                onClick={() => {
                                  setQueue({ state: "idle" });
                                  setSheet({ type: "quick" });
                                }}
                              >
                                <Sparkles size={17} />
                                Quick Match
                              </button>
                              <button onClick={() => go("/live")}>
                                <Video size={17} />
                                Browse rooms
                              </button>
                            </div>
                            <div className="dm-consent">
                              <ShieldCheck size={14} />
                              <span>
                                Both people choose. No surprise calls.
                              </span>
                            </div>
                          </section>
                          <div className="dm-section-title">
                            <h2>Room for a little company.</h2>
                            <button onClick={() => go("/live")}>
                              See all
                              <ArrowUpRight size={15} />
                            </button>
                          </div>
                          <div className="dm-room-grid">
                            {rooms
                              .filter(
                                (r) =>
                                  category !== "Rooms" ||
                                  `${r.title} ${r.topic}`
                                    .toLowerCase()
                                    .includes(query.toLowerCase()),
                              )
                              .slice(0, 2)
                              .map(roomCard)}
                          </div>
                          {!rooms.length && (
                            <div className="dm-empty">
                              <p>No open rooms right now.</p>
                              <button onClick={() => go("/live")}>
                                Create a room
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="dm-secondary-column">
                          <div className="dm-section-title">
                            <div>
                              <span className="dm-kicker">
                                A SHARED INTEREST IS A START
                              </span>
                              <h2>People you might vibe with.</h2>
                            </div>
                          </div>
                          {loading ? (
                            <div className="real-loading" role="status">
                              Finding compatible profiles…
                            </div>
                          ) : (
                            <div className="dm-people-grid">
                              {filtered.map((p) => (
                                <PersonButton
                                  p={p}
                                  key={p.id}
                                  open={() =>
                                    setSheet({ type: "person", person: p })
                                  }
                                />
                              ))}
                            </div>
                          )}
                          {!loading && !filtered.length && (
                            <div className="dm-empty">
                              <Users size={27} />
                              <h3>No one fits those filters right now.</h3>
                              <p>
                                Try another intention or broaden your
                                preferences. No student profiles are fabricated
                                here.
                              </p>
                              <button onClick={() => go("/me")}>
                                Review my visibility
                              </button>
                            </div>
                          )}
                          {nextCursor && (
                            <button
                              className="dm-text-button"
                              onClick={() =>
                                void act(async () => {
                                  const r = await api(
                                    `discover?mode=${mode}&cursor=${nextCursor}`,
                                  );
                                  setPeople((p) => [...p, ...r.profiles]);
                                  setNextCursor(r.nextCursor);
                                })
                              }
                            >
                              More profiles
                            </button>
                          )}
                          <button
                            className="dm-swipe-entry"
                            onClick={() => go("/discover/swipe")}
                          >
                            <span className="dm-swipe-symbol">
                              <Heart size={23} />
                            </span>
                            <div>
                              <span className="dm-kicker">
                                ONE PERSON AT A TIME
                              </span>
                              <h3>Let a little spark find you.</h3>
                              <p>Explore SwipeChat · {mode}</p>
                            </div>
                            <ArrowUpRight size={20} />
                          </button>
                          <section className="dm-campus-teaser">
                            <span className="dm-kicker">AROUND CAMPUS</span>
                            <h3>Belong to something good.</h3>
                            <p>Join a creative corner or a study circle.</p>
                            <button onClick={() => go("/campus")}>
                              Explore campus
                              <ArrowUpRight size={16} />
                            </button>
                          </section>
                        </div>
                      </div>
                    </>
                  )}
                  {page === "Live" && (
                    <>
                      <div className="dm-page-title">
                        <span className="dm-kicker">A LITTLE MORE PRESENT</span>
                        <h1>
                          Find your <em>room.</em>
                        </h1>
                        <p>Actual room availability. Your device choices.</p>
                      </div>
                      <button
                        className="dm-live-quick"
                        onClick={() => {
                          setQueue({ state: "idle" });
                          setSheet({ type: "quick" });
                        }}
                      >
                        <Sparkles size={27} />
                        <div>
                          <h3>Just you and someone new.</h3>
                          <p>Quick Match · Both people must accept</p>
                        </div>
                        <ArrowUpRight size={21} />
                      </button>
                      <div className="dm-section-title">
                        <h2>Open conversations</h2>
                        <button
                          onClick={() => setSheet({ type: "create-room" })}
                        >
                          <Plus size={17} />
                          Create room
                        </button>
                      </div>
                      <div className="dm-live-grid">{rooms.map(roomCard)}</div>
                      <div className="dm-call-note">
                        <ShieldCheck size={21} />
                        <p>
                          No recording by this service.
                          <br />
                          <span>
                            Other participants may still record externally.
                            Leave, report, or block when needed.
                          </span>
                        </p>
                      </div>
                    </>
                  )}
                  {page === "Call" && (
                    <>
                      <VideoRoom
                        roomId={route.split("/")[2]}
                        onReport={(id, name) =>
                          setSheet({ type: "report", person: { id, name } })
                        }
                        onBlock={(id, name) =>
                          setSheet({ type: "block", person: { id, name } })
                        }
                        onKick={(id) =>
                          void act(async () => {
                            await api(
                              `rooms/${route.split("/")[2]}/kick`,
                              "POST",
                              { userId: id },
                            );
                            notify("Participant removed from this room.");
                          })
                        }
                        onLeave={() => {
                          go("/live");
                          void loadRooms();
                        }}
                      />
                      <div className="real-call-safety">
                        <button
                          onClick={() =>
                            setSheet({
                              type: "report",
                              roomId: route.split("/")[2],
                            })
                          }
                        >
                          <Flag size={17} />
                          Report room
                        </button>
                        {rooms.find((r) => r.id === route.split("/")[2])
                          ?.canModerate && (
                          <button
                            onClick={() =>
                              setSheet({
                                type: "room-tools",
                                roomId: route.split("/")[2],
                              })
                            }
                          >
                            <Settings size={17} />
                            Host controls
                          </button>
                        )}
                      </div>
                    </>
                  )}
                  {page === "SwipeChat" && (
                    <section className="dm-swipe-screen">
                      <div className="dm-swipe-header">
                        <button
                          className="dm-back"
                          onClick={() => go("/discover")}
                        >
                          <ArrowLeft size={17} />
                          Discover
                        </button>
                        <span>{mode} · SwipeChat</span>
                        <button
                          aria-label="Preferences"
                          onClick={() => setSheet({ type: "preferences" })}
                        >
                          <SlidersHorizontal size={20} />
                        </button>
                      </div>
                      <div className="real-swipe-stage">
                        <AnimatePresence mode="wait">
                          {filtered[0] ? (
                            <motion.article
                              key={filtered[0].id}
                              className="real-swipe-card"
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, x: reduced ? 0 : 120 }}
                              drag={reduced ? false : "x"}
                              dragConstraints={{ left: 0, right: 0 }}
                              dragElastic={0.65}
                              onDragEnd={(_, i) => {
                                if (Math.abs(i.offset.x) > 70)
                                  void choose(
                                    filtered[0],
                                    i.offset.x > 0 ? "like" : "pass",
                                  );
                              }}
                            >
                              <Portrait person={filtered[0]} />
                              <span className="dm-person-shade" />
                              <button
                                className="real-card-open"
                                aria-label="Read profile"
                                onClick={() =>
                                  setSheet({
                                    type: "person",
                                    person: filtered[0],
                                  })
                                }
                              >
                                <ArrowUpRight size={22} />
                              </button>
                              <div className="real-swipe-copy">
                                <span className="dm-kicker">
                                  {mode.toUpperCase()}
                                </span>
                                <h2>
                                  {filtered[0].name}
                                  {filtered[0].age
                                    ? `, ${filtered[0].age}`
                                    : ""}
                                </h2>
                                <p>{filtered[0].bio}</p>
                                <div className="dm-room-tags">
                                  {filtered[0].interests
                                    .slice(0, 4)
                                    .map((t) => (
                                      <span key={t}>{t}</span>
                                    ))}
                                </div>
                              </div>
                            </motion.article>
                          ) : (
                            <div className="phone-empty">
                              <Sparkles size={35} />
                              <h2>A little more room?</h2>
                              <p>
                                No eligible profiles remain in this selection.
                                Try another intention or check back later.
                              </p>
                              <button
                                className="dm-primary"
                                onClick={() => go("/discover")}
                              >
                                Back to Discover
                              </button>
                            </div>
                          )}
                        </AnimatePresence>
                        {reaction && (
                          <motion.div
                            className="real-reaction"
                            key={reaction}
                            initial={{ scale: 0.6, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                          >
                            <Heart fill="currentColor" />
                            {reaction}
                          </motion.div>
                        )}
                      </div>
                      <div className="phone-decision-bar">
                        <button
                          className="phone-decision decision-pass"
                          aria-label="Pass profile"
                          disabled={busy || !filtered[0]}
                          onClick={() => void choose(filtered[0], "pass")}
                        >
                          <span>
                            <X size={27} />
                          </span>
                          <strong>Pass</strong>
                        </button>
                        <button
                          className="phone-decision decision-like"
                          aria-label="Like profile"
                          disabled={busy || !filtered[0]}
                          onClick={() => void choose(filtered[0], "like")}
                        >
                          <span>
                            <Heart size={30} fill="currentColor" />
                          </span>
                          <strong>Like</strong>
                        </button>
                      </div>
                      <small className="dm-swipe-note">
                        A mutual like opens a conversation. An approved photo is
                        required.
                      </small>
                    </section>
                  )}
                  {page === "Chats" && (
                    <div
                      className={
                        "real-messenger " + (thread ? "has-thread" : "")
                      }
                    >
                      <aside className="real-inbox">
                        <div className="dm-page-title">
                          <span className="dm-kicker">
                            REAL CONNECTIONS, AT YOUR PACE
                          </span>
                          <h1>
                            Let it <em>flow.</em>
                          </h1>
                        </div>
                        {conversations.length ? (
                          conversations.map((c) => (
                            <button
                              className={
                                "real-thread " +
                                (thread?.id === c.id ? "selected" : "")
                              }
                              key={c.id}
                              onClick={() => {
                                setThread(c);
                                setMessages([]);
                                setDraft("");
                              }}
                            >
                              <Portrait person={c.person} />
                              <span>
                                <strong>{c.person.name}</strong>
                                <small>
                                  {c.last?.body || "Say your first hello."}
                                </small>
                              </span>
                              {c.unread > 0 && <b>{c.unread}</b>}
                            </button>
                          ))
                        ) : (
                          <div className="dm-empty">
                            <MessageCircle size={29} />
                            <h3>Good conversations take two.</h3>
                            <p>
                              Mutual matches and accepted Quick Matches appear
                              here.
                            </p>
                            <button onClick={() => go("/discover")}>
                              Discover people
                            </button>
                          </div>
                        )}
                      </aside>
                      <section className="real-conversation">
                        {thread ? (
                          <>
                            <div className="real-thread-header">
                              <button
                                className="real-chat-back"
                                onClick={() => setThread(null)}
                                aria-label="Back to conversations"
                              >
                                <ArrowLeft size={20} />
                              </button>
                              <button
                                className="real-chat-person"
                                onClick={() =>
                                  setSheet({
                                    type: "person",
                                    person: thread.person,
                                  })
                                }
                              >
                                <Portrait person={thread.person} />
                                <strong>{thread.person.name}</strong>
                              </button>
                              <button
                                aria-label="Invite to a video call"
                                onClick={() =>
                                  void act(async () => {
                                    await api("call-invitations", "POST", {
                                      conversationId: thread.id,
                                    });
                                    notify(
                                      "Invitation sent. Your connection must accept before a lobby opens.",
                                    );
                                    setInvitations(
                                      await api("call-invitations"),
                                    );
                                  })
                                }
                              >
                                <Video size={21} />
                              </button>
                              <button
                                aria-label="Conversation safety controls"
                                onClick={() =>
                                  setSheet({
                                    type: "thread-tools",
                                    person: thread.person,
                                    conversationId: thread.id,
                                  })
                                }
                              >
                                <ShieldCheck size={21} />
                              </button>
                            </div>
                            <div className="real-chat-body" aria-live="polite">
                              {!messages.length && (
                                <div className="real-chat-welcome">
                                  <Heart size={25} />
                                  <h3>A little spark. A new story.</h3>
                                  <p>
                                    A thoughtful question is a good place to
                                    start.
                                  </p>
                                </div>
                              )}
                              {messages.map((m) => (
                                <motion.div
                                  initial={{ opacity: 0, y: reduced ? 0 : 8 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  key={m.id}
                                  className={
                                    "real-message " +
                                    (m.sender_id === me.id ? "mine" : "theirs")
                                  }
                                >
                                  <p>{m.body}</p>
                                  <time>
                                    {new Date(m.created_at).toLocaleTimeString(
                                      [],
                                      { hour: "2-digit", minute: "2-digit" },
                                    )}
                                  </time>
                                </motion.div>
                              ))}
                              <div ref={end} />
                            </div>
                            <form
                              className="real-composer"
                              onSubmit={sendMessage}
                            >
                              <textarea
                                rows={1}
                                aria-label="Message"
                                maxLength={2000}
                                value={draft}
                                placeholder="Start something good…"
                                onChange={(e) => setDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    void sendMessage(e);
                                  }
                                }}
                              />
                              <button
                                disabled={busy || !draft.trim()}
                                aria-label="Send message"
                              >
                                <Send size={20} />
                              </button>
                            </form>
                          </>
                        ) : (
                          <div className="real-chat-welcome">
                            <MessageCircle size={33} />
                            <h3>Make space for a conversation.</h3>
                            <p>Choose a connection to start.</p>
                          </div>
                        )}
                      </section>
                    </div>
                  )}
                  {page === "Campus" && (
                    <>
                      <div className="dm-page-title">
                        <span className="dm-kicker">
                          BELONG TO SOMETHING GOOD
                        </span>
                        <h1>
                          Beyond the <em>hello.</em>
                        </h1>
                        <p>Shared interests. Shared plans. Your campus.</p>
                      </div>
                      {group ? (
                        <>
                          <button
                            className="dm-back"
                            onClick={() => setGroup(null)}
                          >
                            <ArrowLeft size={17} />
                            All circles
                          </button>
                          <h2>{group.title}</h2>
                          <p>{group.description}</p>
                          <form
                            className="real-post-form"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void act(async () => {
                                await api(`groups/${group.id}/posts`, "POST", {
                                  body: postDraft,
                                });
                                setPostDraft("");
                                notify("Post submitted for moderator review.");
                              });
                            }}
                          >
                            <label>
                              Share something respectful
                              <textarea
                                value={postDraft}
                                maxLength={2000}
                                rows={3}
                                onChange={(e) => setPostDraft(e.target.value)}
                              />
                            </label>
                            <button
                              className="dm-primary"
                              disabled={busy || !postDraft.trim()}
                            >
                              Submit for review
                              <Send size={17} />
                            </button>
                          </form>
                          {posts.map((p) => (
                            <article className="real-post" key={p.id}>
                              <strong>{p.name}</strong>
                              <p>{p.body}</p>
                              <button
                                onClick={() =>
                                  setSheet({
                                    type: "report",
                                    person: { id: p.author_id, name: p.name },
                                  })
                                }
                              >
                                <Flag size={14} />
                                Report
                              </button>
                            </article>
                          ))}
                          {!posts.length && (
                            <p className="dm-demo-note">
                              No approved posts yet. Be the start of a kind
                              conversation.
                            </p>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="dm-groups">
                            {campus.groups.map((g: any, i: number) => (
                              <article
                                className={
                                  "dm-group " + ["mauve", "sage", "clay"][i % 3]
                                }
                                key={g.id}
                              >
                                <span className="dm-group-icon">
                                  <Users size={27} />
                                </span>
                                <h2>{g.title}</h2>
                                <p>{g.description}</p>
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void act(async () => {
                                      if (!g.joined) {
                                        await api(
                                          `groups/${g.id}/join`,
                                          "POST",
                                          {},
                                        );
                                        await loadCampus();
                                      }
                                      setGroup({ ...g, joined: true });
                                      setPosts([]);
                                    })
                                  }
                                >
                                  {g.joined
                                    ? "Open your circle"
                                    : "Join this circle"}
                                  <ArrowUpRight size={18} />
                                </button>
                                {g.joined && (
                                  <button
                                    onClick={() =>
                                      void act(async () => {
                                        await api(
                                          `groups/${g.id}/leave`,
                                          "POST",
                                          {},
                                        );
                                        await loadCampus();
                                        notify("You left the circle.");
                                      })
                                    }
                                  >
                                    Leave circle
                                  </button>
                                )}
                              </article>
                            ))}
                          </div>
                          <div className="dm-section-title">
                            <h2>Around campus</h2>
                          </div>
                          {campus.events.length ? (
                            campus.events.map((event: any) => (
                              <article className="dm-event" key={event.id}>
                                <BookOpen size={25} />
                                <div>
                                  <h3>{event.title}</h3>
                                  <p>{event.description}</p>
                                  <p>
                                    {new Date(event.starts_at).toLocaleString()}
                                  </p>
                                </div>
                              </article>
                            ))
                          ) : (
                            <div className="dm-empty">
                              <p>No approved upcoming events right now.</p>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                  {page === "Profile" && (
                    <>
                      <div className="dm-page-title">
                        <span className="dm-kicker">YOUR KIND OF YOU</span>
                        <h1>
                          Your story,
                          <br />
                          <em>your choices.</em>
                        </h1>
                      </div>
                      <div className="dm-profile-layout">
                        <div>
                          <div className="dm-self">
                            <Portrait person={mine} />
                            <div>
                              <h2>{mine.name}</h2>
                              <p>Verified mailbox · Eligibility reviewed</p>
                            </div>
                          </div>
                          {photoManager()}
                        </div>
                        <div className="dm-profile-fields">
                          {profileFields()}
                          <button
                            className="dm-primary"
                            disabled={busy}
                            onClick={() => void saveProfile()}
                          >
                            Save profile
                            <Check size={18} />
                          </button>
                          <button
                            className="dm-settings-row"
                            onClick={() =>
                              void act(async () => {
                                setBlocked(await api("blocks"));
                                setSheet({ type: "blocked" });
                              })
                            }
                          >
                            <ShieldCheck size={20} />
                            <span>Blocked accounts</span>
                            <ArrowUpRight size={18} />
                          </button>
                          <button
                            className="dm-settings-row"
                            onClick={() =>
                              void act(async () => {
                                await api("auth/logout", "POST", { all: true });
                                setMe(null);
                                go("/");
                              })
                            }
                          >
                            <LogOut size={20} />
                            <span>Sign out on all devices</span>
                          </button>
                          <button
                            className="dm-text-button real-danger"
                            onClick={() => {
                              setConfirmDelete("");
                              setSheet({ type: "delete-account" });
                            }}
                          >
                            Delete my account
                          </button>
                          {["admin", "moderator"].includes(me.role) && (
                            <button
                              className="dm-primary"
                              onClick={() =>
                                void act(async () => {
                                  setReview(await api("admin/review"));
                                  go("/admin");
                                })
                              }
                            >
                              Moderation console
                              <ShieldCheck size={18} />
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                  {page === "Moderation" &&
                    (["admin", "moderator"].includes(me.role) ? (
                      <>
                        <div className="dm-page-title">
                          <h1>
                            Care for your <em>community.</em>
                          </h1>
                          <p>
                            Restricted review. Private eligibility information
                            must stay here.
                          </p>
                        </div>
                        <button
                          className="dm-primary"
                          onClick={() =>
                            void act(async () =>
                              setReview(await api("admin/review")),
                            )
                          }
                        >
                          Refresh review queue
                        </button>
                        <label className="real-review-label">
                          Review reason / independent eligibility evidence
                          reference
                          <textarea
                            value={reviewReason}
                            maxLength={500}
                            rows={3}
                            onChange={(e) => setReviewReason(e.target.value)}
                            placeholder="Document the basis for your decision; don’t paste identity documents."
                          />
                        </label>
                        <label className="real-checkbox">
                          <input
                            type="checkbox"
                            checked={independentReview}
                            onChange={(e) =>
                              setIndependentReview(e.target.checked)
                            }
                          />
                          I completed the independent adult-eligibility and
                          profile review.
                        </label>
                        <h2>Student activation</h2>
                        {review?.students.map((u: any) => (
                          <article className="real-review-card" key={u.id}>
                            <h3>{u.display_name}</h3>
                            <p>{u.email}</p>
                            <p>
                              Private submitted birth date:{" "}
                              {String(u.birth_date_private).slice(0, 10)}
                            </p>
                            <p>{u.bio}</p>
                            <p>{u.interests.join(" · ")}</p>
                            <div className="real-inline-actions">
                              {["approve", "reject", "suspend"].map(
                                (action) => (
                                  <button
                                    key={action}
                                    disabled={
                                      busy ||
                                      reviewReason.length < 10 ||
                                      (action === "approve" &&
                                        !independentReview)
                                    }
                                    onClick={() =>
                                      void act(async () => {
                                        await api("admin/review", "POST", {
                                          userId: u.id,
                                          action,
                                          reason: reviewReason,
                                        });
                                        setReview(await api("admin/review"));
                                        notify("Review decision recorded.");
                                      })
                                    }
                                  >
                                    {action}
                                  </button>
                                ),
                              )}
                            </div>
                          </article>
                        ))}
                        <h2>Photo review</h2>
                        {review?.photos.map((p: any) => (
                          <article className="real-review-card" key={p.id}>
                            <img
                              src={"/api/photos/" + p.id}
                              alt="Pending profile photo"
                            />
                            <p>
                              Review image safety and suitability before
                              approval.
                            </p>
                            {[true, false].map((approve) => (
                              <button
                                key={String(approve)}
                                disabled={busy || reviewReason.length < 5}
                                onClick={() =>
                                  void act(async () => {
                                    await api("admin/photo", "POST", {
                                      id: p.id,
                                      approve,
                                      reason: reviewReason,
                                    });
                                    setReview(await api("admin/review"));
                                  })
                                }
                              >
                                {approve ? "Approve photo" : "Reject photo"}
                              </button>
                            ))}
                          </article>
                        ))}
                        <h2>Reports</h2>
                        {review?.reports.map((r: any) => (
                          <article className="real-review-card" key={r.id}>
                            <strong>{r.category}</strong>
                            <p>{r.description}</p>
                            <p>Subject: {r.subject_id || r.room_id}</p>
                            {r.subject_id && (
                              <button
                                disabled={busy || reviewReason.length < 10}
                                onClick={() =>
                                  void act(async () => {
                                    await api("admin/review", "POST", {
                                      userId: r.subject_id,
                                      action: "suspend",
                                      reason: reviewReason,
                                    });
                                    setReview(await api("admin/review"));
                                  })
                                }
                              >
                                Suspend subject
                              </button>
                            )}
                            <button
                              onClick={() =>
                                void act(async () => {
                                  await api("admin/report", "POST", {
                                    id: r.id,
                                  });
                                  setReview(await api("admin/review"));
                                })
                              }
                            >
                              Mark resolved
                            </button>
                          </article>
                        ))}
                        <h2>Post review</h2>
                        {review?.posts.map((p: any) => (
                          <article className="real-review-card" key={p.id}>
                            <p>{p.body}</p>
                            {[true, false].map((approve) => (
                              <button
                                key={String(approve)}
                                disabled={busy || reviewReason.length < 5}
                                onClick={() =>
                                  void act(async () => {
                                    await api("admin/post", "POST", {
                                      id: p.id,
                                      approve,
                                      reason: reviewReason,
                                    });
                                    setReview(await api("admin/review"));
                                  })
                                }
                              >
                                {approve ? "Approve post" : "Reject post"}
                              </button>
                            ))}
                          </article>
                        ))}
                      </>
                    ) : (
                      <div className="dm-empty">Moderator access required.</div>
                    ))}
                </motion.div>
              </main>
              {page !== "Call" && (
                <nav className="dm-bottom-nav" aria-label="Main navigation">
                  {tabs.map(([label, Icon, path]) => (
                    <button
                      key={path}
                      aria-label={label}
                      aria-current={
                        page === label ||
                        (label === "Discover" && page === "SwipeChat")
                          ? "page"
                          : undefined
                      }
                      onClick={() => go(path)}
                    >
                      {(page === label ||
                        (label === "Discover" && page === "SwipeChat")) && (
                        <motion.span layoutId="real-nav" />
                      )}
                      <Icon size={22} />
                      <strong>{label}</strong>
                    </button>
                  ))}
                </nav>
              )}
            </>
          )}
          <AnimatePresence>
            {toast && (
              <motion.div
                role="status"
                className="dm-toast"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <Check size={17} />
                {toast}
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {sheet && (
              <motion.div
                className="dm-sheet-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeSheet}
              >
                <motion.section
                  className={
                    "dm-sheet " +
                    (sheet.type === "person" ? "dm-person-sheet" : "")
                  }
                  role="dialog"
                  aria-modal="true"
                  aria-label={sheet.type.replaceAll("-", " ")}
                  initial={{ opacity: 0, y: reduced ? 0 : 50 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduced ? 0 : 50 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="dm-sheet-close"
                    aria-label="Close dialog"
                    onClick={closeSheet}
                  >
                    <X size={22} />
                  </button>
                  {sheet.type === "person" && (
                    <>
                      <div className="real-profile-photo">
                        <Portrait person={sheet.person} />
                      </div>
                      <div className="dm-sheet-content">
                        <span className="dm-kicker">
                          {sheet.person.modes?.join(" · ")}
                        </span>
                        <h2>
                          {sheet.person.name}
                          {sheet.person.age ? `, ${sheet.person.age}` : ""}
                        </h2>
                        <p>
                          {sheet.person.department || ""}{" "}
                          {sheet.person.year || ""}
                        </p>
                        <p>{sheet.person.bio}</p>
                        <div className="dm-room-tags">
                          {sheet.person.interests?.map((t: string) => (
                            <span key={t}>{t}</span>
                          ))}
                        </div>
                        <button
                          className="dm-primary"
                          disabled={busy}
                          onClick={() => void choose(sheet.person, "like")}
                        >
                          <Heart size={18} />
                          Send a like
                        </button>
                        <div className="real-inline-actions">
                          <button
                            onClick={() => {
                              setReportText("");
                              setSheet({
                                type: "report",
                                person: sheet.person,
                              });
                            }}
                          >
                            <Flag size={16} />
                            Report
                          </button>
                          <button
                            onClick={() =>
                              setSheet({ type: "block", person: sheet.person })
                            }
                          >
                            <ShieldCheck size={16} />
                            Block
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                  {sheet.type === "matched" && (
                    <>
                      <Heart
                        className="dm-sheet-icon"
                        size={40}
                        fill="currentColor"
                      />
                      <h2>
                        It’s a shared <em>feeling.</em>
                      </h2>
                      <p>
                        You and {sheet.person.name} liked each other in {mode}.
                        Your conversation is ready.
                      </p>
                      <button
                        className="dm-primary"
                        onClick={() => {
                          go("/chats");
                          notify("Your new conversation is in Chats.");
                        }}
                      >
                        Say hello
                        <MessageCircle size={18} />
                      </button>
                    </>
                  )}
                  {sheet.type === "quick" && (
                    <>
                      <Sparkles size={34} className="dm-sheet-icon" />
                      <span className="dm-kicker">
                        QUICK MATCH · {mode.toUpperCase()}
                      </span>
                      <h2>
                        A conversation
                        <br />
                        you both <em>choose.</em>
                      </h2>
                      {queue.state === "idle" ? (
                        <>
                          <p>
                            We only propose compatible, opted-in adults. Both
                            participants accept before a private lobby is
                            created.
                          </p>
                          <button
                            className="dm-primary"
                            disabled={busy}
                            onClick={() =>
                              void act(async () => {
                                setQueue(
                                  await api("quick-match/enqueue", "POST", {
                                    mode,
                                  }),
                                );
                              })
                            }
                          >
                            Join the queue
                            <ArrowUpRight size={18} />
                          </button>
                        </>
                      ) : queue.state === "queued" ? (
                        <>
                          <div className="real-queue-orbit">
                            <Users size={35} />
                          </div>
                          <p role="status">
                            Waiting for someone compatible. No camera or
                            microphone is being used.
                          </p>
                          <button
                            className="dm-text-button"
                            onClick={() =>
                              void act(async () => {
                                await api("quick-match/cancel", "POST", {});
                                setQueue({ state: "idle" });
                              })
                            }
                          >
                            Cancel waiting
                          </button>
                        </>
                      ) : queue.state === "ready" ? (
                        <>
                          <p>
                            You both accepted. Your private pre-call lobby is
                            ready.
                          </p>
                          <button
                            className="dm-primary"
                            onClick={() => go("/call/" + queue.roomId)}
                          >
                            Open private lobby
                            <Video size={18} />
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="dm-proposal">
                            {queue.person && <Portrait person={queue.person} />}
                            <div>
                              <h3>{queue.person?.name || "New proposal"}</h3>
                              <p>{queue.person?.interests?.join(" · ")}</p>
                              <span>
                                Accept before{" "}
                                {queue.expiresAt
                                  ? new Date(
                                      queue.expiresAt,
                                    ).toLocaleTimeString()
                                  : ""}
                              </span>
                            </div>
                          </div>
                          {queue.accepted ? (
                            <p role="status">
                              Your acceptance is saved. Waiting for the other
                              person.
                            </p>
                          ) : (
                            <button
                              className="dm-primary"
                              disabled={busy}
                              onClick={() =>
                                void act(async () => {
                                  await api(
                                    `quick-match/${queue.id}/respond`,
                                    "POST",
                                    { accept: true },
                                  );
                                  setQueue(await api("quick-match/status"));
                                })
                              }
                            >
                              Accept this connection
                              <Check size={18} />
                            </button>
                          )}
                          <button
                            className="dm-text-button"
                            onClick={() =>
                              void act(async () => {
                                await api(
                                  `quick-match/${queue.id}/respond`,
                                  "POST",
                                  { accept: false },
                                );
                                setQueue({ state: "idle" });
                              })
                            }
                          >
                            Decline and leave queue
                          </button>
                        </>
                      )}
                    </>
                  )}
                  {sheet.type === "create-room" && (
                    <>
                      <Video size={32} className="dm-sheet-icon" />
                      <h2>Make room for company.</h2>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void act(async () => {
                            const r = await api("rooms", "POST", {
                              title: roomTitle,
                              topic: roomTopic,
                              capacity: roomCapacity,
                            });
                            await loadRooms();
                            go("/call/" + r.id);
                          });
                        }}
                      >
                        <label>
                          Room title
                          <input
                            required
                            maxLength={80}
                            value={roomTitle}
                            onChange={(e) => setRoomTitle(e.target.value)}
                          />
                        </label>
                        <label>
                          Topic
                          <select
                            value={roomTopic}
                            onChange={(e) => setRoomTopic(e.target.value)}
                          >
                            {["friends", "study", "music", "gaming"].map(
                              (t) => (
                                <option key={t}>{t}</option>
                              ),
                            )}
                          </select>
                        </label>
                        <label>
                          Capacity
                          <select
                            value={roomCapacity}
                            onChange={(e) =>
                              setRoomCapacity(Number(e.target.value))
                            }
                          >
                            {[2, 3, 4, 5, 6].map((n) => (
                              <option key={n}>{n}</option>
                            ))}
                          </select>
                        </label>
                        <button className="dm-primary" disabled={busy}>
                          Create and open lobby
                          <ArrowUpRight size={18} />
                        </button>
                      </form>
                      <p className="dm-small-print">
                        Creating a room never turns on your camera.
                      </p>
                    </>
                  )}
                  {sheet.type === "preferences" && (
                    <>
                      <SlidersHorizontal size={31} className="dm-sheet-icon" />
                      <h2>Your kind of connection.</h2>
                      <p>
                        Browsing a mode does not opt you into its visibility.
                      </p>
                      <div className="dm-intents">
                        {modes.map(([v, l, I]) => (
                          <button
                            key={v}
                            aria-pressed={mode === v}
                            className={mode === v ? "selected" : ""}
                            onClick={() => setMode(v)}
                          >
                            <I size={15} />
                            {l}
                          </button>
                        ))}
                      </div>
                      <button className="dm-primary" onClick={() => go("/me")}>
                        Edit my visibility and age preferences
                        <Settings size={18} />
                      </button>
                    </>
                  )}
                  {sheet.type === "invitations" && (
                    <>
                      <Bell size={31} className="dm-sheet-icon" />
                      <h2>A little face time?</h2>
                      {invitations.length ? (
                        invitations.map((i) => (
                          <article className="real-review-card" key={i.id}>
                            <h3>{i.person.name}</h3>
                            <p>
                              {i.status === "accepted"
                                ? "Accepted · Private lobby ready"
                                : i.sender_id === me?.id
                                  ? "Invitation sent · Waiting for acceptance"
                                  : "Invited you to a private conversation."}
                            </p>
                            {i.status === "accepted" ? (
                              <button
                                className="dm-primary"
                                onClick={() => go("/call/" + i.room_id)}
                              >
                                Open lobby
                                <Video size={17} />
                              </button>
                            ) : i.recipient_id === me?.id ? (
                              <>
                                <button
                                  className="dm-primary"
                                  disabled={busy}
                                  onClick={() =>
                                    void act(async () => {
                                      const r = await api(
                                        `call-invitations/${i.id}/respond`,
                                        "POST",
                                        { accept: true },
                                      );
                                      go("/call/" + r.roomId);
                                    })
                                  }
                                >
                                  Accept and open lobby
                                </button>
                                <button
                                  className="dm-text-button"
                                  onClick={() =>
                                    void act(async () => {
                                      await api(
                                        `call-invitations/${i.id}/respond`,
                                        "POST",
                                        { accept: false },
                                      );
                                      setInvitations(
                                        await api("call-invitations"),
                                      );
                                    })
                                  }
                                >
                                  Decline
                                </button>
                              </>
                            ) : null}
                          </article>
                        ))
                      ) : (
                        <p>No pending invitations right now.</p>
                      )}
                      <p className="dm-small-print">
                        Opening a lobby never transmits media. You choose
                        devices and deliberately enter.
                      </p>
                    </>
                  )}
                  {sheet.type === "thread-tools" && (
                    <>
                      <ShieldCheck size={32} className="dm-sheet-icon" />
                      <h2>
                        Your connection,
                        <br />
                        your control.
                      </h2>
                      <button
                        className="dm-settings-row"
                        onClick={() =>
                          setSheet({ type: "report", person: sheet.person })
                        }
                      >
                        <Flag size={19} />
                        Report this profile
                      </button>
                      <button
                        className="dm-settings-row"
                        onClick={() =>
                          setSheet({ type: "block", person: sheet.person })
                        }
                      >
                        <ShieldCheck size={19} />
                        Block this account
                      </button>
                      <button
                        className="dm-settings-row"
                        onClick={() =>
                          void act(async () => {
                            await api(
                              `conversations/${sheet.conversationId}/unmatch`,
                              "POST",
                              {},
                            );
                            setSheet(null);
                            setThread(null);
                            await loadConversations();
                            notify(
                              "Connection ended. Future contact is closed.",
                            );
                          })
                        }
                      >
                        <X size={19} />
                        End this connection
                      </button>
                    </>
                  )}
                  {sheet.type === "block" && (
                    <>
                      <ShieldCheck size={32} className="dm-sheet-icon" />
                      <h2>A little more space.</h2>
                      <p>
                        Block {sheet.person.name}? Neither of you can discover,
                        message, or join a room with the other. Active contact
                        is closed.
                      </p>
                      <button
                        className="dm-primary"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await api("blocks", "POST", {
                              userId: sheet.person.id,
                            });
                            setSheet(null);
                            setThread(null);
                            await loadDiscover();
                            await loadConversations();
                            await loadRooms();
                            notify("Account blocked.");
                          })
                        }
                      >
                        Block account
                      </button>
                    </>
                  )}
                  {sheet.type === "report" && (
                    <>
                      <Flag size={32} className="dm-sheet-icon" />
                      <h2>We’re here to listen.</h2>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void act(async () => {
                            await api("reports", "POST", {
                              subjectId: sheet.person?.id,
                              roomId: sheet.roomId,
                              category: reportCategory,
                              description: reportText,
                            });
                            setSheet(null);
                            setReportText("");
                            notify("Your report was submitted to moderators.");
                          });
                        }}
                      >
                        <label>
                          Reason
                          <select
                            value={reportCategory}
                            onChange={(e) => setReportCategory(e.target.value)}
                          >
                            {[
                              "harassment",
                              "sexual_content",
                              "underage",
                              "impersonation",
                              "spam",
                              "other",
                            ].map((c) => (
                              <option key={c} value={c}>
                                {c.replaceAll("_", " ")}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          What happened?
                          <textarea
                            maxLength={1000}
                            rows={4}
                            value={reportText}
                            onChange={(e) => setReportText(e.target.value)}
                          />
                        </label>
                        <button className="dm-primary" disabled={busy}>
                          Submit report
                          <Flag size={17} />
                        </button>
                      </form>
                      <p className="dm-small-print">
                        Reports are restricted to moderators. This service does
                        not record calls or collect video evidence.
                      </p>
                    </>
                  )}
                  {sheet.type === "blocked" && (
                    <>
                      <ShieldCheck size={32} className="dm-sheet-icon" />
                      <h2>Your boundaries.</h2>
                      {blocked.length ? (
                        blocked.map((b) => (
                          <article key={b.id} className="real-review-card">
                            <p>Blocked account · {b.id.slice(0, 8)}</p>
                            <button
                              onClick={() =>
                                void act(async () => {
                                  await api("blocks", "DELETE", {
                                    userId: b.id,
                                  });
                                  setBlocked(await api("blocks"));
                                  notify(
                                    "Block removed. Previous conversations remain closed.",
                                  );
                                })
                              }
                            >
                              Unblock
                            </button>
                          </article>
                        ))
                      ) : (
                        <p>No blocked accounts.</p>
                      )}
                    </>
                  )}
                  {sheet.type === "room-tools" && (
                    <>
                      <Settings size={32} className="dm-sheet-icon" />
                      <h2>Room controls.</h2>
                      <p>
                        Only the room host or a moderator can apply these
                        actions.
                      </p>
                      <button
                        className="dm-primary"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await api(
                              `rooms/${sheet.roomId}/close`,
                              "POST",
                              {},
                            );
                            go("/live");
                            await loadRooms();
                          })
                        }
                      >
                        Close this room
                      </button>
                    </>
                  )}
                  {sheet.type === "delete-account" && (
                    <>
                      <Lock size={32} className="dm-sheet-icon" />
                      <h2>Close your chapter?</h2>
                      <p>
                        Deletion immediately revokes access and removes your
                        profile. Photo-object deletion is queued; limited safety
                        records may be retained under policy. This cannot
                        restore your conversations.
                      </p>
                      <label>
                        Type DELETE to confirm
                        <input
                          value={confirmDelete}
                          onChange={(e) => setConfirmDelete(e.target.value)}
                          autoComplete="off"
                        />
                      </label>
                      <button
                        className="dm-primary"
                        disabled={busy || confirmDelete !== "DELETE"}
                        onClick={() =>
                          void act(async () => {
                            await api("me", "DELETE");
                            setMe(null);
                            go("/");
                            notify(
                              "Account access revoked and deletion requested.",
                            );
                          })
                        }
                      >
                        Delete my account
                      </button>
                    </>
                  )}
                  {sheet.type === "privacy" && (
                    <>
                      <ShieldCheck size={32} className="dm-sheet-icon" />
                      <h2>
                        Connection,
                        <br />
                        with care.
                      </h2>
                      <p>
                        Dorcas Match is an independent student project for
                        verified Babcock students aged 18+. It is not endorsed
                        by the university.
                      </p>
                      <p>
                        Student email and birth-date information are private,
                        used for account verification and eligibility review.
                        Public visibility is a separate choice for Friends,
                        Dating, and Study. Photos are reviewed; direct contact
                        requires a mutual or accepted connection.
                      </p>
                      <p>
                        Calls use peer-to-peer media and may use a TURN relay.
                        The service does not record calls, but peers may record
                        externally and may learn network information. You can
                        leave, block, report, sign out everywhere, or request
                        account deletion.
                      </p>
                      <p>
                        Moderators review restricted eligibility information,
                        reports, photos, and posts. Ordinary messages and
                        approved profile information are visible only to
                        authorized members. Deletion may retain minimum
                        justified safety records and queued photo cleanup. Do
                        not submit identity documents in chat.
                      </p>
                      <p className="dm-small-print">
                        This beta notice describes implemented controls. The
                        operator must finalize legal terms, retention periods, a
                        review method, and a staffed moderation process before
                        opening to real students.
                      </p>
                      <button className="dm-primary" onClick={closeSheet}>
                        I understand
                        <Check size={17} />
                      </button>
                    </>
                  )}
                </motion.section>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </MotionConfig>
  );
  function profileFields() {
    return (
      <div className="real-form-fields">
        <label>
          Display name
          <input
            value={form.display_name}
            maxLength={40}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
          />
        </label>
        <label>
          A little about you
          <textarea
            maxLength={300}
            rows={3}
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
          />
        </label>
        <label>
          Department (optional)
          <input
            maxLength={80}
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
          />
        </label>
        <label>
          Year (optional)
          <input
            maxLength={20}
            value={form.year_level}
            onChange={(e) => setForm({ ...form, year_level: e.target.value })}
          />
        </label>
        <h3>Choose 3–10 interests</h3>
        <div className="phone-interest-chips">
          {[
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
          ].map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={form.interests.includes(t)}
              className={form.interests.includes(t) ? "chosen" : ""}
              onClick={() =>
                setForm({
                  ...form,
                  interests: form.interests.includes(t)
                    ? form.interests.filter((x: string) => x !== t)
                    : form.interests.length < 10
                      ? [...form.interests, t]
                      : form.interests,
                })
              }
            >
              {form.interests.includes(t) && <Check size={12} />} {t}
            </button>
          ))}
        </div>
        <h3>Who can discover me?</h3>
        {modes.map(([v, l, I]) => (
          <button
            key={v}
            type="button"
            role="switch"
            aria-checked={form.modes.includes(v)}
            className="dm-toggle-row"
            onClick={() =>
              setForm({
                ...form,
                modes: form.modes.includes(v)
                  ? form.modes.filter((m: string) => m !== v)
                  : [...form.modes, v],
              })
            }
          >
            <span>
              <I size={15} /> {l}
              <small>
                {v === "dating"
                  ? "Separate, explicit opt-in"
                  : "Only compatible, opted-in adults"}
              </small>
            </span>
            <span
              className={"dm-switch " + (form.modes.includes(v) ? "on" : "")}
            >
              <i />
            </span>
          </button>
        ))}
        {[
          ["paused", "Pause all discovery"],
          ["show_age", "Display my age"],
          ["show_department", "Display department and year"],
        ].map(([key, label]) => (
          <button
            type="button"
            key={key}
            role="switch"
            aria-checked={Boolean(form[key])}
            className="dm-toggle-row"
            onClick={() => setForm({ ...form, [key]: !form[key] })}
          >
            <span>{label}</span>
            <span className={"dm-switch " + (form[key] ? "on" : "")}>
              <i />
            </span>
          </button>
        ))}
        <div className="real-age-fields">
          <label>
            Minimum age
            <input
              type="number"
              min={18}
              max={100}
              value={form.age_min}
              onChange={(e) => setForm({ ...form, age_min: e.target.value })}
            />
          </label>
          <label>
            Maximum age
            <input
              type="number"
              min={18}
              max={100}
              value={form.age_max}
              onChange={(e) => setForm({ ...form, age_max: e.target.value })}
            />
          </label>
        </div>
      </div>
    );
  }
  function photoManager() {
    return (
      <div className="real-photo-manager">
        <h3>Profile photos</h3>
        <p>
          JPEG, PNG, or WebP · up to 5 MB · approval required. Metadata is
          removed before private storage.
        </p>
        <label className="real-upload">
          <Camera size={18} />
          Upload a photo
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </label>
        <div className="real-photo-list">
          {me?.photos
            .filter((p) => p.status !== "delete_pending")
            .map((p) => (
              <div key={p.id}>
                <img
                  src={"/api/photos/" + p.id}
                  alt={"Your photo · " + p.status}
                />
                <span>{p.status}</span>
                <button
                  aria-label="Remove photo"
                  onClick={() =>
                    void act(async () => {
                      await api("me/photos/delete", "POST", { id: p.id });
                      await refreshMe();
                    })
                  }
                >
                  <X size={16} />
                </button>
              </div>
            ))}
        </div>
      </div>
    );
  }
}
