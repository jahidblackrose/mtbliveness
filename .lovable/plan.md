# LiveFaceAI — 4 Changes, Phased

This is a substantial update touching `liveness-config.ts`, `liveness.ts` (~1500 lines), `liveness-i18n.ts`, `liveness-meta.ts`, `challenge-demo.tsx`, and `liveface.tsx` (~3000 lines). To minimize regression risk on the capture pipeline, I'll land it in 3 phases. Each phase ends in a working app you can test.

## Phase A — Foundation (config + i18n + demos)
No behavior change yet; sets up the surface area.

- `liveness-config.ts`: add `FACE_LOST_REDO_MS=1500`, `MOUTH_OPEN_HOLD_MS=250`, `PITCH_UP_SIGN` (auto-calibrated, default `-1`), `NOD_FULL_CYCLE=false`, `PITCH_ABS=0.18`, plus quality thresholds: `LUMA_MAX`, `WB_MAX_DELTA`, `BG_MIN_LUMA`, `BG_MAX_STDDEV`, `GLARE_MAX_RATIO`, `OCCLUSION_MIN_CONF`, `EYE_LEVEL_MAX_PITCH`, `EYE_LEVEL_Y_BAND`.
- `liveness-i18n.ts`: add `faceMovedHold`, `redoLiveness`, `mouthOpen`, `mouthOpenHold`, `lookUp`, `lookDown`, `pitchWrongWay`, plus all new gate hints (`tooBright`, `whiteBalance`, `background`, `glare`, `occlusion`, `eyeLevel`).
- `challenge-demo.tsx`: add `MouthOpenDemo`, split `NodDemo` → `LookUpDemo` + `LookDownDemo`. Wire new kinds in switch.
- Dev-only sliders/readouts for new thresholds.

## Phase B — Detection (Changes 2 & 3)
Core challenge logic — gated and isolated.

- **Change 3 (signed pitch)**: in `liveness.ts`, replace the `nod` evaluator with `lookUp` / `lookDown`. Reuse the turn-left/right structure: axis dominance (`|Δpitch| > |Δyaw|`), started-near-neutral, signed sign-match against `PITCH_UP_SIGN`. Self-calibrate sign on first dominant pitch sample (same pattern as yaw). Wrong-direction → `pitchWrongWay` hint, no pass.
- **Change 2 (mouthOpen)**: new evaluator using `jawOpen` blendshape, EMA α=0.5, baseline neutral capture during the existing baseline phase, pass when `> baseline + 0.25` OR `> 0.40` held `MOUTH_OPEN_HOLD_MS`, smileMax low.
- **Challenge pool**: 1 head movement from `{turnLeft, turnRight, lookUp, lookDown}` + 2 from `{blink, smile, mouthOpen}`, nonce-seeded shuffle (update `liveness-meta.ts` `pickChallenges`).
- Dev readouts: live `jawOpen`, signed pitch label `LOOK-UP / LOOK-DOWN`, per-axis dominance.

## Phase C — Capture Integrity (Changes 1 & 4)
The "trust" layer around the shutter.

- **Change 1 (re-liveness on movement)** in `liveface.tsx` countdown effect:
  - Tier A: face present but `|yaw|>0.18` or `|pitch|>0.18` or `sim<SIM_CAPTURE` → pause countdown, show `faceMovedHold`, resume on re-center.
  - Tier B: face lost `> FACE_LOST_REDO_MS` OR `sim<SIM_PASS` OR identity-change → toast `redoLiveness`, push state back to `challenge` phase, re-arm challenges (keep nonce/session), increment `meta.recaptureCount`, append `meta.recaptureEvents: [{reason, atMs}]`.
- **Change 4 (compliance gates)** — new module `liveness-quality.ts` computing on each frame from the video element + face landmarks:
  - `tooBright`: mean luma of face crop > `LUMA_MAX`.
  - `whiteBalanceOk`: |R̄−Ḡ|, |Ḡ−B̄| < `WB_MAX_DELTA`.
  - `backgroundOk`: mean luma outside face box > `BG_MIN_LUMA` AND stddev < `BG_MAX_STDDEV`.
  - `glareOk`: fraction of pixels with luma > 245 in face region < `GLARE_MAX_RATIO`.
  - `occlusionOk`: per-region landmark confidence ≥ `OCCLUSION_MIN_CONF` for eyes, nose, mouth, oval.
  - `eyeLevelOk`: `|pitch| < EYE_LEVEL_MAX_PITCH` AND face center y within `EYE_LEVEL_Y_BAND`.
  - Each gate must hold 500ms before countdown can start; reuses existing hold-detection helper.
- **Depth honesty**: add `certifiedDepthAdapter?: { score(frame): Promise<{score,compliant}> }` prop on `<LiveFace>`. If present → use it and set `meta.depth.method="certified-sdk"`, `compliant=true`. If absent → keep monocular proxy, `compliant=false`, keep existing notice.
- **Result screen**: collapsible "Compliance details" listing Annexure points a–h with pass/fail + measured value. Persist to `meta.compliance = { annexure:{...}, overallCompliant }`.

## Technical Details

### Signed pitch sign calibration
On first frame where `|Δpitch| > |Δyaw|` and `|Δpitch| > PITCH_ABS`, ask user to "look down" (already the prompt for `lookDown`); whatever sign appears becomes `PITCH_DOWN_SIGN`, opposite is `PITCH_UP_SIGN`. Cache for session. Same pattern already used for yaw.

### Re-arm without losing session
Reset only: `challengeIndex=0`, `passedChallenges=[]`, per-challenge baselines, countdown state. Keep: `sessionNonce`, `challengeOrder`, `mediaRecorder` (still buffering), `faceSignature`, `meta.recaptureEvents` appended.

### Quality gate perf
One `OffscreenCanvas` reused per frame, sampled at ≤10Hz (not every detector tick) to keep main thread free. Face crop = bounding box from landmarks; background = annulus around it.

### Meta additions
```text
meta.recaptureCount: number
meta.recaptureEvents: [{ reason: 'slip'|'lost'|'identity'|'sim', atMs }]
meta.quality: { tooBright, whiteBalanceOk, backgroundOk, glareOk, occlusionOk, eyeLevelOk, values:{...} }
meta.compliance.annexure: { a,b,c,d,e,f:true, g:depth.compliant, h }
meta.compliance.overallCompliant: boolean
```

## Files Touched
- `src/lib/liveness-config.ts` — new constants + sliders
- `src/lib/liveness-i18n.ts` — new strings (Phase A)
- `src/lib/liveness-meta.ts` — challenge pool update (Phase B)
- `src/lib/liveness.ts` — replace nod with lookUp/lookDown, add mouthOpen (Phase B)
- `src/lib/liveness-quality.ts` — NEW, compliance gates (Phase C)
- `src/components/challenge-demo.tsx` — new demos (Phase A)
- `src/routes/liveface.tsx` — countdown re-liveness, gates, depth adapter, compliance panel (Phase C)

## Plan
Land Phase A → confirm preview still works → Phase B → test challenges → Phase C → final review.

**Approve to start with Phase A, or tell me to skip phases / change order.**