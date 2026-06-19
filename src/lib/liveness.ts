import type {
  Classifications,
  Matrix,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";

// ─────────────────────────────────────────────────────────────────────────────
// Landmark indices (MediaPipe FaceMesh 468)
// ─────────────────────────────────────────────────────────────────────────────
const NOSE_TIP = 1;
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;
const FACE_LEFT = 234;
const FACE_RIGHT = 454;
const FACE_TOP = 10;
const FACE_BOTTOM = 152;
const LEFT_CHEEK = 50;
const RIGHT_CHEEK = 280;
const CHIN = 199;

type L = NormalizedLandmark;

// ─────────────────────────────────────────────────────────────────────────────
// Blendshape helpers
// ─────────────────────────────────────────────────────────────────────────────
function bs(cls: Classifications[] | undefined, name: string): number {
  const cats = cls?.[0]?.categories;
  if (!cats) return 0;
  for (const c of cats) if (c.categoryName === name) return c.score;
  return 0;
}

// Extract yaw/pitch/roll (radians) from a 4x4 column-major transformation matrix.
function poseFromMatrix(m: Matrix | undefined): { yaw: number; pitch: number; roll: number } {
  if (!m || !m.data || m.data.length < 16) return { yaw: 0, pitch: 0, roll: 0 };
  const d = m.data;
  // Column-major: element(row, col) = d[col*4 + row]
  const r00 = d[0], r10 = d[1], r20 = d[2];
  const r21 = d[6];
  const r22 = d[10];
  const pitch = Math.atan2(-r20, Math.hypot(r21, r22));
  const yaw = Math.atan2(r10, r00);
  const roll = Math.atan2(r21, r22);
  return { yaw, pitch, roll };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-frame face metrics
// ─────────────────────────────────────────────────────────────────────────────
export type FaceMetrics = {
  blinkLeft: number;
  blinkRight: number;
  blinkAvg: number;
  blinkMax: number;
  smileLeft: number;
  smileRight: number;
  smileAvg: number;
  smileMax: number;
  jawOpen: number;
  yaw: number;
  pitch: number;
  roll: number;
  centerOffset: number;
  faceSize: number;
  noseDx: number; // nose offset from face center, normalized by face width
  noseDy: number; // nose offset from face center, normalized by face height
  depthSpread: number;
  noseRelZ: number;
  fingerprint: number;
};

export function computeMetrics(
  lm: L[],
  blendshapes: Classifications[] | undefined,
  matrix: Matrix | undefined,
): FaceMetrics {
  const blinkLeft = bs(blendshapes, "eyeBlinkLeft");
  const blinkRight = bs(blendshapes, "eyeBlinkRight");
  const smileLeft = bs(blendshapes, "mouthSmileLeft");
  const smileRight = bs(blendshapes, "mouthSmileRight");
  const jawOpen = bs(blendshapes, "jawOpen");

  let pose = poseFromMatrix(matrix);
  if (pose.yaw === 0 && pose.pitch === 0 && pose.roll === 0) {
    const eyeMidX = (lm[LEFT_EYE_OUTER].x + lm[RIGHT_EYE_OUTER].x) / 2;
    const faceW = Math.max(0.0001, lm[FACE_RIGHT].x - lm[FACE_LEFT].x);
    const eyeMidY = (lm[LEFT_EYE_OUTER].y + lm[RIGHT_EYE_OUTER].y) / 2;
    const faceH = Math.max(0.0001, lm[FACE_BOTTOM].y - lm[FACE_TOP].y);
    pose = {
      yaw: ((lm[NOSE_TIP].x - eyeMidX) / faceW) * 2,
      pitch: ((lm[NOSE_TIP].y - eyeMidY) / faceH) * 2,
      roll: 0,
    };
  }

  const cx = (lm[FACE_LEFT].x + lm[FACE_RIGHT].x) / 2;
  const cy = (lm[FACE_TOP].y + lm[FACE_BOTTOM].y) / 2;
  const centerOffset = Math.hypot(cx - 0.5, cy - 0.5);
  const faceWidth = Math.max(0.0001, lm[FACE_RIGHT].x - lm[FACE_LEFT].x);
  const faceSize = lm[FACE_BOTTOM].y - lm[FACE_TOP].y;
  const noseDx = (lm[NOSE_TIP].x - cx) / faceWidth;
  const noseDy = (lm[NOSE_TIP].y - cy) / Math.max(0.0001, faceSize);

  const zs = [
    lm[NOSE_TIP].z, lm[LEFT_EYE_OUTER].z, lm[RIGHT_EYE_OUTER].z,
    lm[LEFT_CHEEK].z, lm[RIGHT_CHEEK].z, lm[FACE_LEFT].z, lm[FACE_RIGHT].z, lm[CHIN].z,
  ];
  const meanZ = zs.reduce((a, b) => a + b, 0) / zs.length;
  const variance = zs.reduce((a, z) => a + (z - meanZ) ** 2, 0) / zs.length;
  const depthSpread = Math.sqrt(variance);
  const meanCheekEar =
    (lm[LEFT_CHEEK].z + lm[RIGHT_CHEEK].z + lm[FACE_LEFT].z + lm[FACE_RIGHT].z) / 4;
  const noseRelZ = lm[NOSE_TIP].z - meanCheekEar;

  const fp =
    lm[NOSE_TIP].x * 1000 + lm[NOSE_TIP].y * 1000 +
    lm[LEFT_EYE_OUTER].x * 100 + lm[RIGHT_EYE_OUTER].x * 100 + lm[CHIN].y * 10;

  return {
    blinkLeft, blinkRight,
    blinkAvg: (blinkLeft + blinkRight) / 2,
    blinkMax: Math.max(blinkLeft, blinkRight),
    smileLeft, smileRight,
    smileAvg: (smileLeft + smileRight) / 2,
    smileMax: Math.max(smileLeft, smileRight),
    jawOpen,
    yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll,
    centerOffset, faceSize, noseDx, noseDy,
    depthSpread, noseRelZ, fingerprint: fp,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Calibration baseline (per session, per user)
// ─────────────────────────────────────────────────────────────────────────────
export type Baseline = {
  blinkOpen: number;     // resting blink-blendshape value (low)
  smileNeutral: number;  // resting smile value
  jawNeutral: number;
  yaw: number;
  pitch: number;
  noseDx: number;
  noseDy: number;
  depthSpread: number;
  noseRelZ: number;
  faceSize: number;
};

export function emptyAccumulator() {
  return {
    n: 0,
    blink: 0,
    smile: 0,
    jaw: 0,
    yaw: 0,
    pitch: 0,
    noseDx: 0,
    noseDy: 0,
    depthSpread: 0,
    noseRelZ: 0,
    faceSize: 0,
  };
}
export type CalibAccumulator = ReturnType<typeof emptyAccumulator>;

export function accumulate(acc: CalibAccumulator, m: FaceMetrics) {
  acc.n += 1;
  // Use MAX for blink/smile to match runtime signal (catches one-eye blinks etc).
  acc.blink += m.blinkMax;
  acc.smile += m.smileMax;
  acc.jaw += m.jawOpen;
  acc.yaw += m.yaw;
  acc.pitch += m.pitch;
  acc.noseDx += m.noseDx;
  acc.noseDy += m.noseDy;
  acc.depthSpread += m.depthSpread;
  acc.noseRelZ += m.noseRelZ;
  acc.faceSize += m.faceSize;
}

export function finalizeBaseline(acc: CalibAccumulator): Baseline {
  const n = Math.max(1, acc.n);
  // Sanity check: a "neutral" baseline that's already high means the user
  // wasn't actually neutral during calibration. Discard and fall back to
  // safe defaults so absolute thresholds remain achievable.
  let blinkOpen = acc.blink / n;
  let smileNeutral = acc.smile / n;
  if (blinkOpen > 0.3) blinkOpen = 0.1;
  if (smileNeutral > 0.25) smileNeutral = 0.05;
  return {
    blinkOpen,
    smileNeutral,
    jawNeutral: acc.jaw / n,
    yaw: acc.yaw / n,
    pitch: acc.pitch / n,
    noseDx: acc.noseDx / n,
    noseDy: acc.noseDy / n,
    depthSpread: acc.depthSpread / n,
    noseRelZ: acc.noseRelZ / n,
    faceSize: acc.faceSize / n,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Challenges
// ─────────────────────────────────────────────────────────────────────────────
export type ChallengeKind = "blink" | "smile" | "turnLeft" | "turnRight" | "nod";


export function pickChallenges(): ChallengeKind[] {
  // 3 challenges total. Always include at least one head movement (parallax
  // check). The remaining two are easier expression actions. Order randomized
  // per session as an anti-replay measure.
  const heads: ChallengeKind[] = ["turnLeft", "turnRight", "nod"];
  const head = heads[Math.floor(Math.random() * heads.length)];
  // Two easy actions — blink and smile are both comfortable.
  const picked: ChallengeKind[] = [head, "blink", "smile"];
  // Fisher–Yates shuffle for random order.
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  return picked;
}


export type ChallengeState = {
  kind: ChallengeKind;
  done: boolean;
  startedAt: number; // ms (performance.now)
  // blink
  blinkCount?: number;
  blinkPhase?: "open" | "closed";
  blinkEma?: number;
  blinkLastCountedAt?: number; // refractory cooldown anchor
  blinkJustCountedAt?: number; // for UI flash animation
  // smile
  smileEma?: number;
  smileHoldStart?: number; // ms when smile rose above threshold
  smileIntensity?: number; // 0..1 for UI meter
  // pose challenges
  poseProgress?: number; // 0..1 toward target
  // parallax check (for turns): track noseRelZ change vs yaw change
  parallaxStartNoseRelZ?: number;
  parallaxStartYaw?: number;
  parallaxOk?: boolean;
  // turn feedback: user is turning the wrong way relative to instruction
  wrongWay?: boolean;
  // nod transition tracker
  nodPhase?: "neutral" | "down" | "up";
  nodPitchEma?: number;
  nodBasePitch?: number;

};

export function newChallengeState(kind: ChallengeKind, now: number): ChallengeState {
  const base: ChallengeState = { kind, done: false, startedAt: now };
  if (kind === "blink")
    return { ...base, blinkCount: 0, blinkPhase: "open", blinkEma: 0, blinkLastCountedAt: 0 };
  if (kind === "smile") return { ...base, smileEma: 0, smileIntensity: 0 };
  return base;
}

// Thresholds — mutable so the dev panel and easy mode can tune them live.
// Two-track design: a RELATIVE-to-baseline threshold AND an ABSOLUTE fallback.
// A signal triggers if EITHER fires, so a bad calibration can't make a
// challenge impossible.
export const TH = {
  CENTER_MAX: 0.18,
  FACE_SIZE_MIN: 0.28,
  FACE_SIZE_MAX: 0.9,
  BRIGHT_MIN: 40,
  // Head turn — ~11° momentary cross.
  YAW_TURN: 0.20,
  YAW_TURN_ABS: 0.20,
  NOSE_TURN_ABS: 0.16,
  // Nod ~10–12°
  PITCH_NOD: 0.18,
  PITCH_NOD_ABS: 0.18,
  NOSE_NOD_ABS: 0.08,
  // Smile — short hold, low floor.
  SMILE_HOLD_MS: 130,
  SMILE_DELTA: 0.08,
  SMILE_ABS: 0.27,
  JAW_TALKING: 0.7,
  // Blink — single peak, very short refractory, low floor.
  BLINK_HIGH_OFFSET: 0.18,
  BLINK_LOW_OFFSET: 0.07,
  BLINK_ABS: 0.40,
  BLINK_REFRACTORY_MS: 150,
  // Spoof
  DEPTH_MIN_RATIO: 0.55,
  PARALLAX_MIN: 0.012,
  // Auto-assist after a stalled attempt.
  ASSIST_AFTER_MS: 2500,
  ASSIST_FACTOR: 0.65,

};

// ─────────────────────────────────────────────────────────────────────────────
// Direction mapping for head-turn (signed). The selfie preview is MIRRORED
// (CSS scaleX(-1)), so the raw landmark/pose coordinates are NOT mirrored;
// we map each signal's sign onto the user's perceived LEFT once, in ONE
// place, and self-calibrate on the first turn if a sign appears inverted.
// ─────────────────────────────────────────────────────────────────────────────
export const DIRECTION = {
  MIRRORED: true,
  // Sign that (m.yaw - baseline.yaw) takes when the user turns to THEIR LEFT.
  // MediaPipe pose-matrix yaw (atan2(r10,r00)) is typically negative for a
  // user's left turn — but device/model variance makes this worth calibrating.
  YAW_LEFT_SIGN: -1 as 1 | -1,
  // Sign that (m.noseDx - baseline.noseDx) takes when user turns to their LEFT.
  // In the unmirrored landmark space, nose moves toward image-right (x↑) when
  // the user turns their physical left, so +1.
  NOSE_LEFT_SIGN: 1 as 1 | -1,
  // Internal: track whether self-calibration ran this session.
  calibratedYaw: false,
  calibratedNose: false,
};
export function resetDirectionCalibration() {
  DIRECTION.calibratedYaw = false;
  DIRECTION.calibratedNose = false;
}

export const EASY = { on: false };
export function setEasyMode(on: boolean) {
  EASY.on = on;
  if (on) {
    TH.SMILE_HOLD_MS = 120;
    TH.SMILE_DELTA = 0.07;
    TH.SMILE_ABS = 0.22;
    TH.BLINK_HIGH_OFFSET = 0.15;
    TH.BLINK_LOW_OFFSET = 0.06;
    TH.BLINK_ABS = 0.35;
    TH.YAW_TURN = 0.16;
    TH.YAW_TURN_ABS = 0.16;
    TH.NOSE_TURN_ABS = 0.13;
    TH.PITCH_NOD = 0.13;
    TH.PITCH_NOD_ABS = 0.13;
    TH.NOSE_NOD_ABS = 0.07;
    TH.DEPTH_MIN_RATIO = 0.45;
  } else {
    TH.SMILE_HOLD_MS = 180;
    TH.SMILE_DELTA = 0.10;
    TH.SMILE_ABS = 0.30;
    TH.BLINK_HIGH_OFFSET = 0.20;
    TH.BLINK_LOW_OFFSET = 0.08;
    TH.BLINK_ABS = 0.45;
    TH.YAW_TURN = 0.22;
    TH.YAW_TURN_ABS = 0.22;
    TH.NOSE_TURN_ABS = 0.18;
    TH.PITCH_NOD = 0.18;
    TH.PITCH_NOD_ABS = 0.18;
    TH.NOSE_NOD_ABS = 0.10;
    TH.DEPTH_MIN_RATIO = 0.55;
  }
}

// Auto-assist factor based on how long the user has been attempting.
function assistMul(state: ChallengeState, now: number) {
  return now - state.startedAt > TH.ASSIST_AFTER_MS ? TH.ASSIST_FACTOR : 1;
}

export function updateChallenge(
  state: ChallengeState,
  m: FaceMetrics,
  baseline: Baseline,
  now: number,
): ChallengeState {
  if (state.done) return state;
  const mul = assistMul(state, now);

  switch (state.kind) {
    case "blink": {
      // Use MAX of the two eyes — averaging hides a real blink.
      const signal = m.blinkMax;
      const prev = state.blinkEma ?? signal;
      const ema = prev * 0.4 + signal * 0.6;

      // Trigger close on EITHER baseline-relative OR absolute floor.
      const highRel = baseline.blinkOpen + TH.BLINK_HIGH_OFFSET * mul;
      const highAbs = TH.BLINK_ABS * mul;
      const lowRel = baseline.blinkOpen + TH.BLINK_LOW_OFFSET * mul;
      const lowAbs = Math.max(0.15, TH.BLINK_ABS * mul - 0.15);

      let phase = state.blinkPhase ?? "open";
      let count = state.blinkCount ?? 0;
      let lastCountedAt = state.blinkLastCountedAt ?? 0;
      let justCountedAt = state.blinkJustCountedAt;

      const isClosed = ema > highRel || ema > highAbs || signal > highAbs;
      const isOpen = ema < lowRel && ema < lowAbs;

      if (phase === "open" && isClosed) {
        phase = "closed";
      } else if (phase === "closed" && isOpen) {
        if (now - lastCountedAt > TH.BLINK_REFRACTORY_MS) {
          count += 1;
          lastCountedAt = now;
          justCountedAt = now;
        }
        phase = "open";
      }
      return {
        ...state,
        blinkEma: ema,
        blinkPhase: phase,
        blinkCount: count,
        blinkLastCountedAt: lastCountedAt,
        blinkJustCountedAt: justCountedAt,
        done: count >= 2,
      };
    }

    case "smile": {
      // MAX side — many smiles are asymmetric.
      const signal = m.smileMax;
      const prev = state.smileEma ?? signal;
      const ema = prev * 0.6 + signal * 0.4;
      const rise = ema - baseline.smileNeutral;
      const deltaTh = TH.SMILE_DELTA * mul;
      const absTh = TH.SMILE_ABS * mul;
      const intensity = Math.max(
        0,
        Math.min(1, Math.max(rise / (deltaTh * 1.5), ema / (absTh * 1.2))),
      );

      // Smile passes on EITHER rise-above-neutral OR absolute floor.
      // Only reject if jaw is VERY open (clearly talking/yawning).
      const smiling = (rise > deltaTh || ema > absTh) && m.jawOpen < TH.JAW_TALKING;

      let holdStart = state.smileHoldStart;
      if (smiling) {
        if (!holdStart) holdStart = now;
      } else {
        holdStart = undefined;
      }
      const heldMs = holdStart ? now - holdStart : 0;
      return {
        ...state,
        smileEma: ema,
        smileHoldStart: holdStart,
        smileIntensity: intensity,
        done: heldMs >= TH.SMILE_HOLD_MS,
      };
    }

    case "turnLeft":
    case "turnRight": {
      // Mirrored video: user's left ↔ image right.
      const targetSign = state.kind === "turnLeft" ? 1 : -1;
      const yawRel = (m.yaw - baseline.yaw) * targetSign;
      const noseRel = (m.noseDx - baseline.noseDx) * targetSign;

      const yawTh = TH.YAW_TURN_ABS * mul;
      const noseTh = TH.NOSE_TURN_ABS * mul;
      const progress = Math.max(
        0,
        Math.min(1, Math.max(yawRel / yawTh, noseRel / noseTh)),
      );

      // Parallax (anti-spoof): unchanged but use whichever signal is moving.
      let pStartZ = state.parallaxStartNoseRelZ;
      let pStartYaw = state.parallaxStartYaw;
      if (pStartZ === undefined && (yawRel > yawTh * 0.25 || noseRel > noseTh * 0.25)) {
        pStartZ = m.noseRelZ;
        pStartYaw = m.yaw;
      }
      let parallaxOk = state.parallaxOk;
      if (pStartZ !== undefined && pStartYaw !== undefined) {
        const dz = Math.abs(m.noseRelZ - pStartZ);
        const dyaw = Math.abs(m.yaw - pStartYaw);
        if (dyaw > yawTh * 0.6) parallaxOk = dz > TH.PARALLAX_MIN;
      }

      // Momentary reach is enough — EITHER pose-matrix yaw OR nose offset.
      const reached = yawRel > yawTh || noseRel > noseTh;
      return {
        ...state,
        poseProgress: progress,
        parallaxStartNoseRelZ: pStartZ,
        parallaxStartYaw: pStartYaw,
        parallaxOk,
        done: reached,
      };
    }

    case "nod": {
      // Combined nod signal: pitch from pose matrix + nose vertical offset
      // (whichever is moving more). Detect a TRANSITION: cross a threshold
      // in one direction then return toward neutral. Accept either order
      // (up-then-down or down-then-up). A single momentary cross is enough
      // once the auto-assist kicks in.
      const pitchSigned =
        Math.abs(m.pitch - baseline.pitch) > Math.abs(m.noseDy - baseline.noseDy) * 1.8
          ? m.pitch - baseline.pitch
          : m.noseDy - baseline.noseDy; // noseDy: + = down
      const prev = state.nodPitchEma ?? pitchSigned;
      const ema = prev * 0.5 + pitchSigned * 0.5;
      const pitchTh = Math.min(TH.PITCH_NOD_ABS, TH.NOSE_NOD_ABS * 2.2) * mul;

      let phase = state.nodPhase ?? "neutral";
      let count = state.blinkCount ?? 0; // reuse counter slot
      let lastAt = state.blinkLastCountedAt ?? 0;

      const justCount = () => {
        count += 1;
        lastAt = now;
      };

      if (phase === "neutral") {
        if (ema > pitchTh) phase = "down";
        else if (ema < -pitchTh) phase = "up";
      } else if (phase === "down") {
        if (ema < pitchTh * 0.3 && now - lastAt > 120) {
          justCount();
          phase = "neutral";
        }
      } else if (phase === "up") {
        if (ema > -pitchTh * 0.3 && now - lastAt > 120) {
          justCount();
          phase = "neutral";
        }
      }

      // Generous auto-assist: after ASSIST_AFTER_MS, a single momentary cross
      // (without a return) counts as done.
      const momentary = Math.abs(ema) > pitchTh;
      const done = count >= 1 || (mul < 1 && momentary);

      const progress = Math.max(
        0,
        Math.min(1, Math.abs(ema) / pitchTh),
      );
      return {
        ...state,
        poseProgress: progress,
        nodPhase: phase,
        nodPitchEma: ema,
        blinkCount: count,
        blinkLastCountedAt: lastAt,
        done,
      };
    }

  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Framing gate
// ─────────────────────────────────────────────────────────────────────────────
export type GuidanceKey =
  | "center"
  | "onePerson"
  | "searching"
  | "tooDark"
  | "closer"
  | "back"
  | "straight"
  | "holdStill";

export function frameGuidance(
  faces: number,
  m: FaceMetrics | null,
  brightness: number,
): { ok: boolean; key: GuidanceKey } {
  if (faces === 0) return { ok: false, key: "center" };
  if (faces > 1) return { ok: false, key: "onePerson" };
  if (!m) return { ok: false, key: "searching" };
  if (brightness < TH.BRIGHT_MIN) return { ok: false, key: "tooDark" };
  if (m.faceSize < TH.FACE_SIZE_MIN) return { ok: false, key: "closer" };
  if (m.faceSize > TH.FACE_SIZE_MAX) return { ok: false, key: "back" };
  if (m.centerOffset > TH.CENTER_MAX) return { ok: false, key: "center" };
  if (Math.abs(m.yaw) > 0.25 || Math.abs(m.pitch) > 0.25)
    return { ok: false, key: "straight" };
  return { ok: true, key: "holdStill" };
}

export function avgBrightness(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sw = 32;
  const sh = Math.max(1, Math.round((sw * h) / w));
  try {
    const data = ctx.getImageData(0, 0, sw, sh).data;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return total / (data.length / 4);
  } catch {
    return 128;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Anti-spoof tracker (frame freeze, brightness flicker, depth structure)
// ─────────────────────────────────────────────────────────────────────────────
export class SpoofGuard {
  private fpHistory: number[] = [];
  private brightnessHistory: number[] = [];
  private readonly MAX = 30;

  push(fp: number, brightness: number) {
    this.fpHistory.push(fp);
    this.brightnessHistory.push(brightness);
    if (this.fpHistory.length > this.MAX) this.fpHistory.shift();
    if (this.brightnessHistory.length > this.MAX) this.brightnessHistory.shift();
  }

  /** Returns a problem string if a spoof signal is detected, else null. */
  check(m: FaceMetrics, baseline: Baseline): string | null {
    // Depth structure: a printed photo / screen produces near-planar z.
    if (
      baseline.depthSpread > 0.001 &&
      m.depthSpread < baseline.depthSpread * TH.DEPTH_MIN_RATIO
    ) {
      return "Flat surface detected";
    }

    if (this.fpHistory.length >= 10) {
      const recent = this.fpHistory.slice(-10);
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const variance =
        recent.reduce((a, x) => a + (x - mean) ** 2, 0) / recent.length;
      // Real faces always have micro-motion → fingerprint variance > tiny epsilon.
      if (variance < 1e-6) return "No motion — possible replay";
    }
    return null;
  }
}
