import { createHash, createHmac, randomUUID } from "node:crypto";
import { fail } from "./security";
const sha = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
const hmac = (k: string | Buffer, s: string) =>
  createHmac("sha256", k).update(s).digest();
export function storageReady() {
  return [
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ].every((k) => Boolean(process.env[k]));
}
function signed(method: string, key: string, body: Buffer = Buffer.alloc(0)) {
  if (!storageReady())
    fail(503, "STORAGE", "Photo storage is not configured yet.");
  const endpoint = new URL(process.env.S3_ENDPOINT!);
  const region = process.env.S3_REGION || "auto";
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = date.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const path = `${endpoint.pathname.replace(/\/$/, "")}/${encodeURIComponent(process.env.S3_BUCKET!)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const payload = sha(body),
    headers = `host:${endpoint.host}\nx-amz-content-sha256:${payload}\nx-amz-date:${date}\n`;
  const canonical = [
    method,
    path,
    "",
    headers,
    "host;x-amz-content-sha256;x-amz-date",
    payload,
  ].join("\n");
  const signing = hmac(
    hmac(
      hmac(hmac("AWS4" + process.env.S3_SECRET_ACCESS_KEY!, day), region),
      "s3",
    ),
    "aws4_request",
  );
  const signature = createHmac("sha256", signing)
    .update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha(canonical)}`)
    .digest("hex");
  return {
    url: `${endpoint.origin}${path}`,
    headers: {
      "x-amz-content-sha256": payload,
      "x-amz-date": date,
      Authorization: `AWS4-HMAC-SHA256 Credential=${process.env.S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
    },
  };
}
export async function putPhoto(
  userId: string,
  input: Buffer,
  id = randomUUID(),
) {
  if (input.length > 5 * 1024 * 1024)
    fail(413, "PHOTO_SIZE", "Choose an image smaller than 5 MB.");
  const jpeg = input[0] === 255 && input[1] === 216 && input[2] === 255,
    png = input
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    webp =
      input.subarray(0, 4).toString() === "RIFF" &&
      input.subarray(8, 12).toString() === "WEBP";
  if (!jpeg && !png && !webp)
    fail(422, "PHOTO_TYPE", "Choose a JPEG, PNG, or WebP image.");
  const sharp = (await import("sharp")).default;
  let output: Buffer;
  try {
    output = await sharp(input, {
      limitInputPixels: 24_000_000,
      animated: false,
    })
      .rotate()
      .resize(1200, 1500, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    fail(422, "PHOTO_TYPE", "This image could not be safely decoded.");
  }
  const key = `profiles/${userId}/${id}.webp`;
  const req = signed("PUT", key, output!);
  const r = await fetch(req.url, {
    method: "PUT",
    headers: { ...req.headers, "Content-Type": "image/webp" },
    body: new Uint8Array(output!),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) fail(503, "STORAGE", "Photo storage is temporarily unavailable.");
  return key;
}
export async function getPhoto(key: string) {
  const req = signed("GET", key);
  const r = await fetch(req.url, {
    headers: req.headers,
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!r.ok) fail(404, "PHOTO", "Photo unavailable.");
  return r;
}
export async function removePhoto(key: string) {
  const req = signed("DELETE", key);
  const r = await fetch(req.url, {
    method: "DELETE",
    headers: req.headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok && r.status !== 404) throw new Error("Object cleanup failed");
}
