# MATCH

A small anonymous group video call built with Next.js, TypeScript, Tailwind CSS and native WebRTC. One shared room, at most six participants. No accounts, cookies, database or paid API. Signaling uses the included `ws` WebSocket server on the same port as Next.js. Media travels directly between browsers; the signaling server does not receive video/audio. Free Google/Cloudflare STUN servers help discover network routes.

## Run on your computer

Install Node.js 22+ and npm. Unzip this project, then run:

```sh
npm ci
npm run dev
```

Open http://localhost:3000 in Chrome, Edge, Firefox or Safari. Click **Join Call**, then allow camera and microphone. Devices need both a camera and microphone for this proof of concept. Mute/unmute, camera on/off and Leave Call are available after joining. Leave stops local media tracks and closes peer connections. Closing a browser tab removes that participant; crashed/network-lost tabs are removed by server heartbeat within about 30 seconds. Losing the signaling connection ends the local call and offers a fresh join.

For a production-mode local run:

```sh
npm run build
npm start
```

`PORT=3001 npm start` selects another port (PowerShell: `$env:PORT=3001; npm start`). Keep one Node process: all room membership lives in memory. Do not run behind a load balancer with multiple instances. This custom WebSocket server requires a persistent Node process; static hosting and ordinary serverless function hosting will not work.

## Test across phones and PCs, without a paid service

`localhost` on a phone refers to the phone, not your PC. Plain HTTP LAN addresses such as `http://192.168.1.20:3000` do not provide camera access in normal browsers. Use a trusted HTTPS address.

The easiest temporary test is a free Cloudflare Quick Tunnel (no Cloudflare account required):

1. Install `cloudflared` from https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/ on the computer running MATCH.
2. Start MATCH using the commands above.
3. In a second terminal run:

   ```sh
   cloudflared tunnel --url http://localhost:3000
   ```

4. Copy the generated `https://…trycloudflare.com` URL. Open the **same URL** on every phone/PC. The tunnel forwards both HTTP and secure WebSocket signaling. No separately configured signaling URL or port is needed.
5. Click Join Call and allow camera/microphone on each device. Use headphones or keep the devices in separate rooms to avoid acoustic feedback.
6. Start with two devices on the same Wi-Fi, then three. Next put one phone on mobile data and repeat. Add devices up to six. Each device sends one media copy per peer, so bandwidth and CPU usage grow with room size. The default target capture is 640×360 at 24 fps (max 30).
7. Verify remote video/audio, mute, camera off/on, leave and rejoin, closing a tab, denying permission and the seventh participant being refused. A muted participant's video should continue; turning off the camera should preserve audio. On iOS, keep Safari in the foreground. Tap “Tap to play audio” if browser autoplay is blocked.

Keep the app and tunnel processes running for the whole test. A Quick Tunnel URL is public and temporary; anyone with it can enter the single shared room. Sharing a new tunnel URL does not create a separate room on the same server. Quick Tunnels are free testing infrastructure with availability/usage limits, not an uptime guarantee.

Alternative: use an HTTPS reverse proxy with a trusted certificate on your LAN. Forward WebSocket upgrades at `/signal` along with normal HTTP requests, and preserve the original Host header. You must install/trust any private certificate authority on every device. Do not disable browser security to get camera access.

## Connectivity limits and diagnostics

STUN is not a media relay. Some symmetric NATs, corporate firewalls and mobile networks cannot establish a direct route. HTTPS tunneling solves camera access and signaling reachability, but does not relay WebRTC media. If two guests remain “Connecting…” or show “Connection failed,” try the same Wi-Fi, disable VPN temporarily if appropriate, or test another network. Use `chrome://webrtc-internals` (Chrome/Edge) or `about:webrtc` (Firefox) to inspect ICE candidate pairs, packet loss and bitrate. Log those observations on each device to assess video quality; a successful signaling test does not prove media connectivity.

For reliable connectivity on those networks you need a TURN relay, such as the free open-source coturn server on a machine with a public IP. Software is free; hosting and bandwidth may cost money. This project intentionally does not depend on a paid relay or include public TURN credentials. To add your own, extend `iceServers` in `app/page.tsx` with your TURN URL and credentials; use short-lived credentials for any public deployment.

Anonymity here means no application registration or personal information collection. Peers can learn one another's IP addresses through WebRTC; the host/tunnel/STUN operator may observe network metadata. The app does not record, but other participants can record externally. Guest labels are generated from random, per-connection IDs and reset on rejoin.

## Validation

```sh
npm test
npm run typecheck
npm run build
```

The automated test uses real WebSocket clients to verify shared membership, directed signaling, media status, disconnect removal and the six-person cap. It does not emulate cameras or verify media quality across physical devices. Complete the device checklist above before drawing connectivity conclusions.

## Files

- `app/page.tsx`: responsive lobby/call UI, permissions, peer connections, ICE buffering and cleanup.
- `app/globals.css`: Tailwind entry plus responsive visual styling.
- `signaling.ts`: ephemeral room, validated signaling routing, capacity, payload/rate limits and heartbeat.
- `server.ts`: shared Next.js HTTP/WebSocket server.
- `tests/signaling.test.ts`: multi-client protocol integration test.

## Deploy to Render (free)

Commit this project to a GitHub repository. In Render, select **New → Blueprint**, connect that repository, and apply `render.yaml`. Alternatively select **New → Web Service**, connect the repository, choose **Node** and **Free**, set build command to `npm ci --include=dev && npm run build` and start command to `npm start`. Render supplies `PORT` and HTTPS automatically. Use one instance; all callers must open the same `https://…onrender.com` URL. WebSocket signaling upgrades at `/signal` on this same address.

The free instance can sleep when inactive; opening the site may take a minute to wake it. Monthly free usage limits apply. Restarts/deployments disconnect all participants. No paid plan is required for this proof of concept. After deployment repeat the phone/PC checklist above using the Render URL instead of a tunnel.
