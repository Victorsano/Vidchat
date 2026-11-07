// Local-only synthetic media check. Run dev-fixtures.ts first. No physical devices.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const contexts = [];
try {
  await mkdir("output/playwright", { recursive: true });
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({
      storageState: `.local/browser-state-${i}.json`,
      viewport: { width: 390, height: 844 },
    });
    contexts.push(context);
    await context.addInitScript({ path: "scripts/browser-synthetic-media.js" });
    const page = await context.newPage();
    await page.goto(
      "http://localhost:3000/call/00000000-0000-4000-8000-000000000001",
    );
    await page.getByRole("button", { name: "Mic off", exact: true }).click();
    await page.getByRole("button", { name: "Camera off", exact: true }).click();
    await page.getByRole("button", { name: "Enter room", exact: true }).click();
    await page.locator(".call-meta").waitFor({ timeout: 20000 });
  }
  let results = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    results = await Promise.all(
      contexts.map((c) =>
        c.pages()[0].evaluate(async () => {
          const inbound = [];
          for (const pc of window.__rtcTestPeers)
            for (const r of (await pc.getStats()).values())
              if (r.type === "inbound-rtp")
                inbound.push({
                  kind: r.kind,
                  bytesReceived: r.bytesReceived,
                  framesDecoded: r.framesDecoded,
                });
          return {
            states: window.__rtcTestPeers.map((pc) => pc.connectionState),
            inbound,
          };
        }),
      ),
    );
    if (
      results.every(
        (r) =>
          r.inbound.some((s) => s.kind === "video" && s.framesDecoded > 5) &&
          r.inbound.some((s) => s.kind === "audio" && s.bytesReceived > 0),
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log(
    JSON.stringify({ syntheticMediaOnly: true, peers: results }, null, 2),
  );
  assert(
    results.every(
      (r) =>
        r.states.includes("connected") &&
        r.inbound.some((s) => s.kind === "video" && s.framesDecoded > 5) &&
        r.inbound.some((s) => s.kind === "audio" && s.bytesReceived > 0),
    ),
    "Both peers must receive audio packets and decoded video frames",
  );
  for (let i = 0; i < contexts.length; i++)
    await contexts[i]
      .pages()[0]
      .screenshot({
        path: `output/playwright/mobile-media-peer-${i}.png`,
        fullPage: true,
      });
  for (const c of contexts) {
    const page = c.pages()[0];
    await page.locator(".leave").click();
    assert(
      await page.evaluate(() =>
        window.__rtcTestPeers.every((pc) => pc.connectionState === "closed"),
      ),
    );
  }
  console.log(
    "PASS: two-way synthetic audio/video and peer cleanup at mobile viewport",
  );
  // Rejoin silently, then attach devices to the already-negotiated transceivers.
  for (const c of contexts) {
    const page = c.pages()[0];
    await page.reload();
    await page.getByRole("button", { name: "Enter room", exact: true }).click();
    await page.locator(".call-meta").waitFor();
  }
  for (const c of contexts) {
    const page = c.pages()[0];
    await page
      .getByRole("button", { name: "Unmute microphone", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Turn camera on", exact: true })
      .click();
  }
  let received = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const ready = await Promise.all(
      contexts.map((c) =>
        c.pages()[0].evaluate(async () => {
          for (const pc of window.__rtcTestPeers) {
            let audio = false,
              video = false;
            for (const r of (await pc.getStats()).values()) {
              if (
                r.type === "inbound-rtp" &&
                r.kind === "audio" &&
                r.bytesReceived > 0
              )
                audio = true;
              if (
                r.type === "inbound-rtp" &&
                r.kind === "video" &&
                r.framesDecoded > 5
              )
                video = true;
            }
            if (audio && video) return true;
          }
          return false;
        }),
      ),
    );
    if (ready.every(Boolean)) {
      received = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(
    received,
    "Devices enabled after silent entry must transmit in both directions",
  );
  for (const c of contexts) await c.pages()[0].locator(".leave").click();
  console.log(
    "PASS: devices enabled after silent entry transmit in both directions",
  );
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
