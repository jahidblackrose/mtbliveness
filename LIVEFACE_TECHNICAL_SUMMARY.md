# LiveFaceAI — Technical Summary (for independent verification)

This document describes everything the LiveFaceAI module does end-to-end:
the user flow, the math behind each detection, the anti-spoof / anti-fraud
heuristics, the post-capture pipeline, and the metadata submitted to the
server. It is meant to let an independent reviewer reproduce, verify, or
challenge each decision.

> **Trust model.** The module runs entirely in the user's browser. Every
> client-side signal is **advisory**. The final accept/reject decision
> **MUST** be made server-side by re-verifying the submitted media, the
> nonce, the timestamps, and (optionally) re-running landmark / face
> matching there. See `LIVEFACE_README.md` for the integration contract.

---

## 1. High-level flow

```
URL params ─▶ Consent ─▶ Camera + Model ─▶ Framing gate ─▶ Calibration
        ▼
 Identity reference locked at end of calibration
        ▼
 Challenge 1 ─▶ Challenge 2 ─▶ Challenge 3 ─▶ Challenge 4
   (2 easy + 1 single easy head turn + 1 surprise; fail-forward; locked once passed)
   (identity compared CONTINUOUSLY on near-frontal frames between & during challenges)
        ▼
 Post-pass integrity gate (same face? face-swap? mismatch?)
        ▼
 Look-straight hold ─▶ 3-2-1 countdown ─▶ Frame capture (JPEG)
        ▼
 Stop 10-s rolling video buffer ─▶ assemble WebM ─▶ in-app preview
        ▼
 Build meta JSON (hashes, device, camera, timeline, scores) ─▶ POST multipart

 Retake: always re-runs the FULL flow (all challenges again, never skip).
```


Each step is described below.

---

## 2. Inputs (`src/lib/liveness-meta.ts → readSessionFromUrl`)

Read from `window.location.search`:

| Param        | Type   | Meaning                                                        |
| ------------ | ------ | -------------------------------------------------------------- |
| `nonce`      | string | Host-app-issued session token. Drives challenge order + digits |
| `issued`     | number | Unix ms when nonce was minted (for staleness)                  |
| `exp`        | number | Unix ms hard expiry                                            |
| `challenges` | csv    | Optional explicit list overriding nonce-derived order          |
| `voice`      | bool   | If `1/true`, enables mic + 4-digit lip-sync prompt             |
| `dev`        | `1`    | Shows the debug panel and threshold sliders                    |

`isNonceStale(params, now)` returns true if `now > exp`, or — when no `exp`
is given — if `now - issued > 2 min`. A stale or missing nonce is recorded
in `meta` for the server but **does not** block the user (server's call).

---

## 3. Consent gate

Implemented in `src/routes/liveface.tsx` (`step === "consent"`).
The user must explicitly tick a checkbox stating they agree to biometric
capture (image + 10-second video, optionally audio) **before** the camera
is requested. The accepted consent string carries a `CONSENT_TEXT_VERSION`
(currently `"v1"`) which is included in `meta.consent` so the server can
audit which text was shown.

A per-session attempt counter (`MAX_SESSION_ATTEMPTS = 3`) gates retries.
On exhaustion the UI transitions to `step === "blocked"` until the page
is reloaded with a new nonce.

---

## 4. Camera + model bootstrap (gesture-safe ordering)

`start()` in `liveface.tsx`:

1. **Synchronously** kick off
   `navigator.mediaDevices.getUserMedia({ video, audio: enableVoice })`
   inside the user's click handler. (Awaiting model downloads first loses
   the iOS/Safari gesture context and the camera prompt never re-appears
   on republish.)
2. In parallel, `await FilesetResolver.forVisionTasks(...)` + create
   `FaceLandmarker` with:
   - `runningMode: "VIDEO"`
   - `numFaces: 2` (so we can detect "more than one face in frame")
   - `outputFaceBlendshapes: true`
   - `outputFacialTransformationMatrixes: true`
3. `await streamPromise`, wire it to `<video>`, start `MediaRecorder`.

Model: MediaPipe `face_landmarker_v1` float16, GPU delegate.

---

## 5. Per-frame metrics (`computeMetrics` in `src/lib/liveness.ts`)

For every frame we call `landmarker.detectForVideo()` and derive:

### 5.1 Pose (yaw / pitch / roll, radians)

Primary source: MediaPipe's facial transformation matrix
(column-major 4x4). With elements `r_ij`:

```
yaw   = atan2(-r20, hypot(r21, r22))   // around vertical axis
pitch = atan2(r21, r22)                // around horizontal axis
roll  = atan2(r10, r00)
```

Fallback (if matrix unavailable): a landmark-only estimate using
nose-to-eye-line geometry (`poseFromLandmarks`). The fallback uses
the same sign convention so downstream code is unchanged.

### 5.2 Expression signals (MediaPipe blendshapes, 0..1)

- `blinkLeft / blinkRight` = `eyeBlinkLeft / eyeBlinkRight`
- `blinkMax = max(L, R)` — important: averaging hides one-eye blinks.
- `smileLeft / smileRight` = `mouthSmileLeft / mouthSmileRight`
- `smileMax = max(L, R)` — many smiles are asymmetric.
- `jawOpen` — used to reject smile when the user is clearly talking.

### 5.3 Geometry (normalized landmark coords, 0..1)

- `centerOffset = hypot(faceCenterX-0.5, faceCenterY-0.5)`
- `faceSize    = faceBottom.y − faceTop.y`
- `noseDx      = (noseTip.x − faceCenterX) / faceWidth`
- `noseDy      = (noseTip.y − faceCenterY) / faceSize`

### 5.4 Depth structure

`depthSpread = stdev(z-values of nose, eyes, cheeks, jawline, chin)`.
A printed photo or flat screen produces near-zero z-variance; a real
3-D face does not.

`noseRelZ = noseTip.z − mean(cheek/ear z-values)`. This is the parallax
signal: as the user yaws their head, a real nose's relative z changes
because the nose is forward of the cheek plane. A flat photo's noseRelZ
barely moves with yaw.

### 5.5 Frame fingerprint

A scalar combining nose, eye-outer and chin coordinates with different
weights. Used by `SpoofGuard` only to detect a frozen frame (variance
collapse over the last 10 frames → replay).

---

## 6. Framing gate (`frameGuidance`)

Before any challenge starts, every frame must pass:

| Check          | Threshold (default)                | Failure key   |
| -------------- | ---------------------------------- | ------------- |
| faces == 1     | exactly one face                   | center / onePerson |
| brightness     | mean luma ≥ 40 (0..255)            | tooDark       |
| face too small | `faceSize ≥ 0.28`                  | closer        |
| face too big   | `faceSize ≤ 0.90`                  | back          |
| off-center     | `centerOffset ≤ 0.18`              | center        |
| pose tilt      | `|yaw|, |pitch| ≤ 0.25 rad (≈14°)` | straight      |

The gate must hold continuously for `FRAMING_HOLD_MS = 500 ms`.

Brightness is sampled by drawing the current frame to a 32-wide canvas
and computing perceptual luma (`0.299R + 0.587G + 0.114B`).

---

## 7. Calibration baseline (`accumulate` → `finalizeBaseline`)

During `CALIBRATION_MS = 1500 ms` of "hold still, look straight", every
frame's metrics are accumulated and averaged into a `Baseline`:

- `blinkOpen`, `smileNeutral`, `jawNeutral` — resting expression levels.
- `yaw`, `pitch` — resting head pose (not zero in practice).
- `noseDx`, `noseDy` — resting nose offset (depends on face geometry).
- `depthSpread`, `noseRelZ`, `faceSize` — geometry references.

Sanity clamps: if the calibrated `blinkOpen > 0.3` the user wasn't really
neutral; we discard it and substitute `0.1`. Same for smile > 0.25 → 0.05.
This guarantees the absolute thresholds remain achievable later.

We also snapshot 3–5 `FaceSignature` samples (Section 11) to use as the
identity reference for the post-pass integrity gate.

---

## 8. Challenges

### 8.1 Selection

**Four** challenges per session, nonce-seeded order:

- **2 easy** picks from `{ blink, smile, mouthOpen }` (no duplicates).
- **1 single easy head turn**: either `turnLeft` **or** `turnRight` (never
  both, never paired together — only one head movement per session, to
  preserve a single parallax / depth cue without overburdening the user).
- **1 surprise** from `{ randomSequence }` (+ `readDigits` when
  `voice=1`). `followDot`, `lookUp`, `lookDown`, and `nod` are **removed**
  from all selection pools (kept behind disabled `CHALLENGE_FLAGS` only).

If a `nonce` is present we seed a deterministic PRNG
(`mulberry32(FNV-1a(nonce))`) so the same nonce always yields the same
4-tuple and order — the server can predict and verify what the user was
asked to do (`pickChallengesFromNonce` in `liveness-meta.ts`).

### 8.2 Blink (`updateChallenge` case `"blink"`)

Signal: `blinkMax`, EMA-smoothed (`α = 0.6`). Two-track threshold:

- closed-state enter: `ema > baseline.blinkOpen + 0.20` **or** `ema > 0.45`
- open-state re-enter: `ema < baseline.blinkOpen + 0.08` **and** `ema < 0.30`

State machine `open → closed → open` increments a counter; refractory
window `BLINK_REFRACTORY_MS = 150 ms` prevents double-counting. Passes
when `count ≥ 2`.

### 8.3 Smile (`updateChallenge` case `"smile"`)

Signal: `smileMax`, EMA-smoothed. Passes if **either** `rise > 0.10`
**or** `ema > 0.30` holds for `SMILE_HOLD_MS = 180 ms`, **and**
`jawOpen < 0.7` (rejects talking/yawn).

### 8.4 Mouth-open (`updateChallenge` case `"mouthOpen"`)

Signal: `jawOpen`. Passes on a sustained open beyond baseline neutral.
Replaces `nod` as the "third easy" option.

### 8.5 Head-turn (LEFT/RIGHT) — eased, nose-authoritative

Implemented in `inspectHeadGesture`. Defaults relaxed from earlier
versions: `YAW_TURN_ABS = 0.12` (was 0.20), `NOSE_TURN_ABS = 0.10`
(was 0.16), `nearNeutral` multiplier raised 0.35 → 0.7 so the user does
not need to be perfectly centered before starting.

```
yawChange   = (m.yaw   - baseline.yaw)   * YAW_LEFT_SIGN
noseChange  = (m.noseDx - baseline.noseDx) * NOSE_LEFT_SIGN
targetDir   = +1 (turnLeft) | -1 (turnRight)

yawVote   = yawChange  * targetDir  >  YAW_TURN_ABS
noseVote  = noseChange * targetDir  >  NOSE_TURN_ABS
pass      = startedNearNeutral && (yawVote || noseVote)
```

- **Nose is authoritative for direction.** `wrongDir` is only surfaced
  when the *nose* confirms the opposite-side movement; a noisy yaw sign
  alone never raises "wrong direction".
- Single easy turn only — `nod` is no longer selected.

### 8.6 Mirror / sign self-calibration (`calibrateYawSignFromNose`)

Selfie video is CSS-mirrored (`scaleX(-1)`); landmarks are not.
`YAW_LEFT_SIGN` is **locked from the first confident nose movement**
(nose is the ground truth for "user's left"). If signed yaw disagrees
with nose direction, `YAW_LEFT_SIGN` is flipped once for the session.
This eliminates the "wrong direction" failure caused by yaw sign drift.

### 8.7 Random sequence (surprise challenge)

A nonce-seeded ordered pair of two easy actions (e.g. "Blink, then
Smile"). Picked by `pickSeqActions` / `seqActionsFromNonce`, which:

- draws both steps from `{ blink, smile, mouthOpen }` (head moves never
  appear inside a sequence — they're reserved for the dedicated turn
  slot);
- the pair and order are deterministic from the nonce, so the server
  re-derives and verifies them;
- the UI shows fully-rendered, localized labels (no `{a}`/`{b}` template
  leaks) plus animated demos for each sub-step;
- meta records `randomSequence = { steps: [a,b], completedInOrder }`.

### 8.8 Auto-assist

After `ASSIST_AFTER_MS = 2500 ms` on the current challenge, numeric
thresholds for that challenge are multiplied by `ASSIST_FACTOR = 0.65`.
Sign / axis-dominance gates are not removed.

### 8.9 Fail-forward semantics

- Passed challenges are **locked**. A failure only retries the current
  challenge, never earlier ones.
- `CHALLENGE_TIMEOUT_MS = 20 000 ms` (30 000 ms in easy mode), up to
  `MAX_ATTEMPTS = 3` per challenge.
- Whole session capped at `SESSION_TIMEOUT_MS = 120 000 ms`.
- **Retake always restarts the full flow** — all 4 challenges run
  again, then capture. Already-passed challenges are *not* skipped to a
  direct re-shutter.



---

## 9. Anti-spoof: `SpoofGuard`

Three signals, evaluated continuously:

1. **Depth structure.** If `m.depthSpread < baseline.depthSpread · 0.55`,
   the face is suspiciously planar → `"Flat surface detected"`.
2. **Motion fingerprint.** If the per-frame fingerprint's variance over
   the last 10 frames is `< 1e-6`, the video is frozen / replayed →
   `"No motion — possible replay"`.
3. **Parallax check** (turn challenges only). After the user yaws past
   `0.6 · yawTh`, we require `Δz²(noseRelZ) > PARALLAX_MIN²` (default
   `0.012`). A photo turned in front of the camera fails this because
   the nose doesn't move forward of the cheek plane.

Parallax cannot **pass** a challenge on its own — it can only reject
an otherwise-passing turn that lacks 3-D structure.

---

## 10. Continuous identity gate (`FaceSignature`)

Goal: from the **end of calibration** through to the **shutter** we must
guarantee the **same person** is in the frame — including *between* and
*during* challenges, to close the inter-challenge face-swap gap. We
compute a small, view-stable geometric signature:

```
S = {
  eyeWidthOverFaceWidth = (RightEyeOuter.x - LeftEyeOuter.x) / faceWidth
  noseToEyeY            = (NoseTip.y - eyeMidY)              / faceHeight
  chinToEyeY            = (Chin.y    - eyeMidY)              / faceHeight
  cheekOverFaceWidth    = (RightCheek.x - LeftCheek.x)        / faceWidth
}
```

Similarity:
`sim = 1 − 2.5 · mean(rel_diff_i)` clamped to `[0,1]`,
where `rel_diff(x,y) = |x-y| / mean(|x|,|y|)`.

- The reference is **locked at the end of calibration** (average of 3–5
  baseline samples) and is the same reference used from that point on.
- Comparison runs **continuously** from then until capture. A sustained
  dip below `INTEGRITY.SIM_PASS = 0.62` for `FAIL_SUSTAIN_MS = 700 ms`
  triggers a **full restart from challenge 1** with a bilingual notice.
- `INTEGRITY.SIM_CAPTURE = 0.58` is a hard gate at the shutter.
- **Pose robustness.** The signature is only evaluated on **near-frontal
  frames**; during head turns, mouth-open, big smiles, etc., we **hold
  the last good sim** rather than letting normal expression/pose changes
  falsely trip an identity restart.
- If the same face leaves and returns within tolerance, the 3-2-1
  countdown pauses then resumes (no penalty for blinking out).



---

## 11. Capture sequence

1. **Look-straight hold** (`LOOK_STRAIGHT_HOLD_MS = 500 ms`):
   `|yaw| ≤ 0.18` **and** `|pitch| ≤ 0.18`.
2. **Countdown** 3 → 2 → 1 (`COUNTDOWN_INTERVAL_MS = 1000 ms`).
   Pauses if face leaves or integrity drops; resumes when it returns.
3. **Shutter.** White flash (`FLASH_MS = 200 ms`). The current
   `<video>` frame is drawn to a canvas, exported as
   `image/jpeg, quality=0.92`. Quality gates: face centered, sharp
   (high-frequency energy estimate), not back-lit.
4. **Stop the 10-s rolling buffer.** `MediaRecorder` runs continuously
   with `VIDEO_CHUNK_MS = 1000` and we keep the last
   `VIDEO_WINDOW_MS = 10 000 ms` of chunks. On capture we stop,
   concatenate the kept chunks into a single WebM Blob, and revoke any
   prior preview URL.
5. **Preview.** The webm and the JPEG are shown in-app with Retake and
   Submit buttons.

The webm includes audio iff `enableVoice = true`. When voice is on, a
4-digit prompt derived deterministically from the nonce
(`digitsFromNonce(nonce, 4)`) is shown for the user to read aloud; the
server can independently re-derive the expected digits and run ASR on
the audio track.

---

## 12. Metadata (`buildMeta`) — submitted alongside media

The multipart POST contains `image` (JPEG), `video` (WebM, optional
audio), and a `meta` JSON form field with at least:

```jsonc
{
  "sessionId":        "uuid v4 generated client-side",
  "sessionNonce":     "<host-supplied or null>",
  "nonceIssuedAt":    1718900000000,
  "expiresAt":        1718900120000,
  "nonceStale":       false,
  "consent": { "accepted": true, "version": "v1", "acceptedAt": 1718900001000 },
  "challengeOrder":   ["blink","turnLeft","smile","randomSequence"],
  "challengeTimeline": [
    {"kind":"blink","startedAt":1718900010000,"finishedAt":1718900011200,"attempts":1,"passed":true},
    {"kind":"turnLeft","startedAt":1718900011200,"finishedAt":1718900013400,"attempts":1,"passed":true},
    {"kind":"smile","startedAt":1718900013400,"finishedAt":1718900014800,"attempts":1,"passed":true},
    {"kind":"randomSequence","startedAt":1718900014800,"finishedAt":1718900017900,"attempts":1,"passed":true,
     "meta":{"randomSequence":{"steps":["blink","mouthOpen"],"completedInOrder":true}}}
  ],
  "easyMode":         false,
  "attempts":         1,
  "captureQuality":   { "centerOffset": 0.04, "faceSize": 0.51, "brightness": 132, "sharpness": 0.27 },
  "livenessScore":    0.86,   // weighted blend of challenge confidences
  "depth":            { "method": "blendshape-z-variance", "score": 0.71, "compliant": true },
  "parallax":         { "ok": true, "deltaNoseZ": 0.019 },
  "spoofFlags":       [],     // ["flat-surface", "no-motion", ...]
  "identity":         { "simAtCapture": 0.83, "simMin": 0.71, "continuous": true,
                        "referenceLockedAt": "calibration-end" },

  "device":           { "userAgent": "...", "platform": "...", "language": "...", "timezone": "Asia/Dhaka",
                        "screen": {"w":1920,"h":1080,"dpr":1.25} },
  "camera":           { "label": "FaceTime HD Camera", "virtualCameraSuspected": false,
                        "settings": {...}, "capabilities": {...} },
  "voice":            { "enabled": true, "expectedDigits": "4715" },
  "media":            { "imageSha256": "...64hex...", "videoSha256": "...64hex..." },
  "version":          "liveface-1.x",
  "needsManualReview": false
}
```

Important conventions for the server:

- **Hashes are advisory.** They detect accidental corruption in transit
  but not a malicious client (which can hash anything). Re-hash on the
  server and store both.
- **`virtualCameraSuspected`** is matched against a denylist of substring
  patterns: `obs`, `manycam`, `virtual`, `snap camera`, `xsplit`,
  `droidcam`, `epoccam`, `ndi`, `ivcam`, `reincubate`, `e2esoft`. False
  positives exist; treat as a risk signal, not a hard fail.
- **`nonceStale`** is a hint. The server should re-check expiry against
  its own clock using its own minted issued-at, not the client's.
- **`needsManualReview`** is set when client-side scores are borderline
  (e.g. parallax ok but sim was briefly low). Prefer routing to manual
  review over hard-failing a real person.

---

## 13. Dev panel (`?dev=1`)

Shown only when the URL contains `dev=1`. Surfaces live values useful
for verification:

- Signed `yaw`, signed `pitch` (radians, post-sign-calibration).
- `yawChange`, `pitchChange` (delta from baseline).
- `dominantAxis` (`yaw` | `pitch` | `none`).
- `resolved` (`TURN-LEFT` | `TURN-RIGHT` | `LOOK-UPDOWN` | `none`).
- `pass`, `correctAxis`, `correctSign`, `startedNearNeutral`.
- Threshold sliders for `YAW_TURN_ABS`, `PITCH_NOD_ABS`,
  `SMILE_HOLD_MS`, `SMILE_ABS`, `BLINK_ABS`, `DEPTH_MIN_RATIO`.
- Toggle for `setEasyMode(on)` (loosens all thresholds in lockstep).

The panel is read-only over the network: changing a slider only mutates
the in-memory `TH` object; it does not change what the server enforces.

---

## 14. Reproducing / verifying client decisions

To verify any pass/fail decision against the recorded WebM:

1. Re-run MediaPipe face_landmarker on each frame of the WebM.
2. Re-compute `FaceMetrics` and `Baseline` using the same averaging
   logic (Section 7); the first ~1.5 s of video is the calibration
   window.
3. Re-run `inspectHeadGesture` / blink / smile logic with the
   thresholds in `TH` (default, unless `meta.easyMode === true`).
4. Compare to `meta.challengeTimeline`. Discrepancies indicate either
   client-side tampering or model-version drift — both should be
   treated as a fail by the server.

For audio-on sessions, ASR the audio track and compare the recognized
digits to `meta.voice.expectedDigits` (which the server can also
re-derive from the nonce).

---

## 15. Files of record

| File                              | Responsibility                                       |
| --------------------------------- | ---------------------------------------------------- |
| `src/routes/liveface.tsx`         | UI, state machine, capture, submit                   |
| `src/lib/liveness.ts`             | Metrics, baseline, challenges, spoof, signature      |
| `src/lib/liveness-config.ts`      | Timeouts, buffer sizes, version constants            |
| `src/lib/liveness-meta.ts`        | Nonce parsing, deterministic order, device/camera    |
| `src/lib/liveness-i18n.ts`        | Bangla + English strings (Bangla is default)         |
| `src/components/challenge-demo.tsx` | Animated micro-demos shown above each challenge    |
| `LIVEFACE_README.md`              | Host-app integration contract                        |
| `LIVEFACE_TECHNICAL_SUMMARY.md`   | This document                                        |

---

## 16. Known limitations (be explicit with reviewers)

- All client-side scores can be forged. Anti-spoof here raises cost,
  it does not prove liveness. **Server re-verification is mandatory.**
- Virtual-camera detection is label-based and trivially bypassed by
  renaming a device. Treat it as a soft signal.
- The blendshape-based depth check is a proxy, not stereo depth. A
  carefully-curved screen can spoof it.
- Threshold values are tuned on typical webcams in normal lighting.
  Very wide-angle lenses (e.g. some phones) can shift baselines enough
  that auto-assist kicks in earlier than intended.
- The geometric face signature is identity-discriminative for
  near-frontal poses only; we therefore evaluate it during the
  look-straight hold and at the moment of capture, not mid-turn.
