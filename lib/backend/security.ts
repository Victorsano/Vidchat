import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (status: number, code: string, message: string): never => {
  throw new ApiError(status, code, message);
};
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export const otp = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export function otpHash(email: string, code: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production")
    fail(503, "CONFIGURATION", "Account verification is unavailable");
  return createHmac("sha256", secret || "local-development-only")
    .update(`${email}:${code}`)
    .digest("hex");
}
export function equal(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function validTotp(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.toUpperCase().replace(/=|\s/g, "")) {
    const n = alphabet.indexOf(char);
    if (n < 0) return false;
    bits += n.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  if (bytes.length < 16) return false;
  for (const delta of [-1, 0, 1]) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000) + delta));
    const mac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
    const at = mac[19] & 15;
    const number = (mac.readUInt32BE(at) & 0x7fffffff) % 1000000;
    if (equal(String(number).padStart(6, "0"), code)) return true;
  }
  return false;
}
export const normalizeEmail = (s: string) => s.trim().toLowerCase();
export const admins = () =>
  new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean),
  );
export const eligibleEmail = (s: string) =>
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@student\.babcock\.edu\.ng$/i.test(s);
export function ageAt(birth: string, now = new Date()) {
  const d = new Date(birth);
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  if (
    now.getUTCMonth() < d.getUTCMonth() ||
    (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())
  )
    age--;
  return age;
}
export function adult(birth: string, now = new Date()) {
  const d = new Date(birth + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(birth) ||
    !Number.isFinite(+d) ||
    d.toISOString().slice(0, 10) !== birth
  )
    return false;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  if (
    now.getUTCMonth() < d.getUTCMonth() ||
    (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())
  )
    age--;
  return age >= 18 && age <= 100;
}
export function cookies(request: Request) {
  return Object.fromEntries(
    (request.headers.get("cookie") || "").split(";").map((x) => {
      const i = x.indexOf("=");
      return [x.slice(0, i).trim(), x.slice(i + 1)];
    }),
  );
}
export function requireOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (process.env.NODE_ENV === "production" && !process.env.APP_ORIGIN)
    fail(503, "ORIGIN_CONFIG", "The application origin is not configured.");
  const url = new URL(request.url);
  const expected =
    process.env.APP_ORIGIN ||
    `${url.protocol}//${request.headers.get("host") || url.host}`;
  if (!origin || origin !== expected)
    fail(403, "ORIGIN", "Request origin was not accepted");
}
export function cookie(raw: string, clear = false) {
  return `dorcas_session=${clear ? "" : raw}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 60 * 60 * 24 * 7}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
