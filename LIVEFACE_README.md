# LiveFaceAI — embeddable browser liveness

On-device active face liveness (MediaPipe FaceLandmarker) with bilingual UI (Bangla default + English), 3 randomized challenges, integrity gate, 10-second rolling video, photo capture, and a session-bound API submission.

> **The browser is untrusted.** Every signal computed in the client is **advisory only**.
> A user controls their own camera and browser, so liveness, depth, quality, virtual-camera, and lip-sync results can be bypassed. Your **server must independently re-verify** the submitted media against the issued nonce before granting access.

## Quick embed

The flow is a TanStack Start route at `/liveface`. Host apps embed it in an iframe and pass session data via URL query params.

```html
<iframe
  src="https://your-app.example/liveface?nonce=NONCE&issued=ISSUED_MS&exp=EXP_MS&voice=1"
  allow="camera; microphone"
  width="420" height="720"
></iframe>
```

### Supported params

| Param | Type | Purpose |
|---|---|---|
| `nonce` | string | Server-issued one-time token. Used to **derive** challenge order and digit prompt deterministically, and echoed in submission meta so the server can bind the video to this session. |
| `issued` | epoch ms | Time the nonce was minted. |
| `exp` | epoch ms | Hard expiry. Stale nonces are rejected client-side (server must also enforce). |
| `challenges` | csv | Optional explicit order, e.g. `turnLeft,blink,smile`. Allowed kinds: `blink, smile, turnLeft, turnRight, nod`. Overrides nonce-derived order. |
| `voice` | `1`/`true` | Enable mic + on-screen digit prompt. Audio track is included in `liveness.webm` so the server can run ASR. |
| `dev` | `1` | Show developer panel + live readouts. |

If no nonce is provided the route still works, but the session is **not bound** and the submission `meta.sessionNonce` is `null` — the server cannot detect replay.

## Submission payload

`POST` (multipart) to `VITE_LIVENESS_API_ENDPOINT` with optional `VITE_LIVENESS_API_KEY` bearer:

- `image` — JPEG selfie
- `video` — `video/webm` (last ~10 s, includes audio when `voice=1`)
- `meta` — JSON, includes:
  - `sessionNonce`, `nonceIssuedAt`, `nonceExpiresAt`
  - `consent` `{ given, timestamp, textVersion }`
  - `challengeOrder`, `perChallengeTimestamps` (start/end per challenge)
  - `perChallengeResult`, `blinkCount`, `livenessScore`
  - `voice` `{ enabled, expectedDigits, asrRequired }` (when on)
  - `imageHash`, `videoHash` (SHA-256, for tamper/dedupe)
  - `device` (UA, platform, language, timezone, screen)
  - `camera` `{ label, virtualCameraSuspected, settings, capabilities }`
  - `attemptCount`, `integrityDecision`, `videoMime`
  - `clientNotice` — explicit "advisory only" disclaimer

## Server responsibilities (mandatory)

1. **Verify the nonce** — exists, not expired, never used before, bound to the user/request you issued it for. Reject `meta.sessionNonce` you didn't mint.
2. **Re-derive the expected challenge order and digits** from the nonce; reject submissions where `challengeOrder` / `perChallengeTimestamps` don't match.
3. **Re-run liveness on the video.** Treat `livenessScore` as a hint, not a decision.
4. **Run ASR** on the audio track and confirm the spoken digits match `voice.expectedDigits`. The client only verifies that lips moved while audio was produced.
5. **Hash check** — recompute SHA-256 of received `image`/`video` and compare to `imageHash`/`videoHash`. Mismatch ⇒ tampering in transit.
6. **Throttle by user/IP** independently. The client `attemptCount` is just a hint — clients can lie.
7. **Weigh risk flags** — `camera.virtualCameraSuspected`, missing `getCapabilities`, stale timing, etc. Don't auto-fail real users with privacy extensions, but don't pass-through trust either.

## Requirements

- HTTPS (camera + mic require a secure context).
- Browser: Chromium ≥ 100, Safari ≥ 16, Firefox ≥ 110.
- Video codec: `video/webm` (vp9 → vp8 fallback). Browsers without `MediaRecorder` fall back to image-only submission.
- Voice mode requires microphone permission.

## Local config

`src/lib/liveness-config.ts`:
- `CONSENT_TEXT_VERSION` — bump when consent copy changes; reflected in `meta.consent.textVersion`.
- `MAX_SESSION_ATTEMPTS` — soft cap before the UI shows `tooManyAttempts` (the server enforces the real lockout).
- `NONCE_DEFAULT_TTL_MS` — fallback when host doesn't send `exp`.

## Limits / known gaps

- Single-camera pseudo-depth, not hardware 3D. Browser cannot detect a high-quality replay attack reliably.
- Virtual-camera detection is **heuristic only** (track-label pattern match).
- Lip-sync correlation is mouth-open + audio-energy presence, not speech recognition — ASR is server-side.
- Geolocation, full IP fingerprinting, and replay-attack ML are out of scope for this client.
