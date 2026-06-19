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
  // blendshapes
  blinkLeft: number;
  blinkRight: number;
  blinkAvg: number;
  smileLeft: number;
  smileRight: number;
  smileAvg: number;
  jawOpen: number;
  // pose (radians from matrix; falls back to landmark estimate)
  yaw: number;
  pitch: number;
  roll: number;
  // framing
  centerOffset: number;
  faceSize: number;
  // depth (pseudo) — variance of normalized z across key landmarks
  depthSpread: number;
  noseRelZ: number; // nose z minus mean of cheek/ear z (more negative = closer)
  // raw landmark fingerprint for freeze detection
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
  // Fallback yaw via nose vs eye midpoint if matrix is empty.
  if (pose.yaw === 0 && pose.pitch === 0 && pose.roll === 0) {
    const eyeMidX = (lm[LEFT_EYE_OUTER].x + lm[RIGHT_EYE_OUTER].x) / 2;
    const faceWidth = Math.max(0.0001, lm[FACE_RIGHT].x - lm[FACE_LEFT].x);
    const eyeMidY = (lm[LEFT_EYE_OUTER].y + lm[RIGHT_EYE_OUTER].y) / 2;
    const faceHeight = Math.max(0.0001, lm[FACE_BOTTOM].y - lm[FACE_TOP].y);
    pose = {
      yaw: ((lm[NOSE_TIP].x - eyeMidX) / faceWidth) * 2,
      pitch: ((lm[NOSE_TIP].y - eyeMidY) / faceHeight) * 2,
      roll: 0,
    };
  }

  const cx = (lm[FACE_LEFT].x + lm[FACE_RIGHT].x) / 2;
  const cy = (lm[FACE_TOP].y + lm[FACE_BOTTOM].y) / 2;
  const centerOffset = Math.hypot(cx - 0.5, cy - 0.5);
  const faceSize = lm[FACE_BOTTOM].y - lm[FACE_TOP].y;

  // Depth structure across key points (z is in camera space; smaller = closer).
  const zs = [
    lm[NOSE_TIP].z,
    lm[LEFT_EYE_OUTER].z,
    lm[RIGHT_EYE_OUTER].z,
    lm[LEFT_CHEEK].z,
    lm[RIGHT_CHEEK].z,
    lm[FACE_LEFT].z,
    lm[FACE_RIGHT].z,
    lm[CHIN].z,
  ];
  const meanZ = zs.reduce((a, b) => a + b, 0) / zs.length;
  const variance = zs.reduce((a, z) => a + (z - meanZ) ** 2, 0) / zs.length;
  const depthSpread = Math.sqrt(variance);
  const meanCheekEar =
    (lm[LEFT_CHEEK].z + lm[RIGHT_CHEEK].z + lm[FACE_LEFT].z + lm[FACE_RIGHT].z) / 4;
  const noseRelZ = lm[NOSE_TIP].z - meanCheekEar;

  // Cheap fingerprint of geometry to detect frozen/replayed frames.
  const fp =
    lm[NOSE_TIP].x * 1000 +
    lm[NOSE_TIP].y * 1000 +
    lm[LEFT_EYE_OUTER].x * 100 +
    lm[RIGHT_EYE_OUTER].x * 100 +
    lm[CHIN].y * 10;

  return {
    blinkLeft,
    blinkRight,
    blinkAvg: (blinkLeft + blinkRight) / 2,
    smileLeft,
    smileRight,
    smileAvg: (smileLeft + smileRight) / 2,
    jawOpen,
    yaw: pose.yaw,
    pitch: pose.pitch,
    roll: pose.roll,
    centerOffset,
    faceSize,
    depthSpread,
    noseRelZ,
    fingerprint: fp,
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
    depthSpread: 0,
    noseRelZ: 0,
    faceSize: 0,
  };
}
export type CalibAccumulator = ReturnType<typeof emptyAccumulator>;

export function accumulate(acc: CalibAccumulator, m: FaceMetrics) {
  acc.n += 1;
  acc.blink += m.blinkAvg;
  acc.smile += m.smileAvg;
  acc.jaw += m.jawOpen;
  acc.yaw += m.yaw;
  acc.pitch += m.pitch;
  acc.depthSpread += m.depthSpread;
  acc.noseRelZ += m.noseRelZ;
  acc.faceSize += m.faceSize;
}

export function finalizeBaseline(acc: CalibAccumulator): Baseline {
  const n = Math.max(1, acc.n);
  return {
    blinkOpen: acc.blink / n,
    smileNeutral: acc.smile / n,
    jawNeutral: acc.jaw / n,
    yaw: acc.yaw / n,
    pitch: acc.pitch / n,
    depthSpread: acc.depthSpread / n,
    noseRelZ: acc.noseRelZ / n,
    faceSize: acc.faceSize / n,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Challenges
// ─────────────────────────────────────────────────────────────────────────────
export type ChallengeKind = "blink" | "smile" | "turnLeft" | "turnRight" | "nod";

export const CHALLENGE_LABEL: Record<ChallengeKind, string> = {
  blink: "Blink twice",
  smile: "Smile",
  turnLeft: "Turn your head left",
  turnRight: "Turn your head right",
  nod: "Nod your head",
};

export function pickChallenges(): ChallengeKind[] {
  // Always include at least one head turn (parallax test).
  const turn: ChallengeKind = Math.random() < 0.5 ? "turnLeft" : "turnRight";
  const others: ChallengeKind[] = ["blink", "smile", "nod"];
  // shuffle others
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const picked: ChallengeKind[] = [turn, others[0], others[1]];
  // shuffle final order
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
};

export function newChallengeState(kind: ChallengeKind, now: number): ChallengeState {
  const base: ChallengeState = { kind, done: false, startedAt: now };
  if (kind === "blink")
    return { ...base, blinkCount: 0, blinkPhase: "open", blinkEma: 0, blinkLastCountedAt: 0 };
  if (kind === "smile") return { ...base, smileEma: 0, smileIntensity: 0 };
  return base;
}

// Thresholds (mostly derived from baseline at call time).
export const TH = {
  CENTER_MAX: 0.18,
  FACE_SIZE_MIN: 0.28,
  FACE_SIZE_MAX: 0.9,
  BRIGHT_MIN: 40,
  YAW_TURN: 0.45,   // ~26° from matrix-derived yaw
  PITCH_NOD: 0.35,
  SMILE_HOLD_MS: 280,
  SMILE_DELTA: 0.18,        // smoothed smile must exceed baseline by this
  JAW_TALKING: 0.35,        // ignore smile if jaw is wide (talking/yawning)
  BLINK_HIGH_OFFSET: 0.35,  // closed threshold = baseline + this
  BLINK_LOW_OFFSET: 0.12,   // open threshold = baseline + this
  BLINK_EYE_SYM: 0.25,      // both eyes must move together (max diff at peak)
  BLINK_REFRACTORY_MS: 250, // cooldown before next blink can count
  DEPTH_MIN_RATIO: 0.55,    // current depthSpread must be ≥ baseline * this
  PARALLAX_MIN: 0.012,      // noseRelZ change required over a head turn
};

export function updateChallenge(
  state: ChallengeState,
  m: FaceMetrics,
  baseline: Baseline,
  now: number,
): ChallengeState {
  if (state.done) return state;

  switch (state.kind) {
    case "blink": {
      // Light EMA so peaks survive on low FPS.
      const prev = state.blinkEma ?? m.blinkAvg;
      const ema = prev * 0.4 + m.blinkAvg * 0.6;

      const lowThresh = baseline.blinkOpen + TH.BLINK_LOW_OFFSET;
      const highThresh = baseline.blinkOpen + TH.BLINK_HIGH_OFFSET;
      const eyesSymmetric = Math.abs(m.blinkLeft - m.blinkRight) < TH.BLINK_EYE_SYM;

      let phase = state.blinkPhase ?? "open";
      let count = state.blinkCount ?? 0;
      let lastCountedAt = state.blinkLastCountedAt ?? 0;
      let justCountedAt = state.blinkJustCountedAt;

      if (phase === "open" && ema > highThresh && eyesSymmetric) {
        phase = "closed";
      } else if (
        phase === "closed" &&
        ema < lowThresh &&
        now - lastCountedAt > TH.BLINK_REFRACTORY_MS
      ) {
        phase = "open";
        count += 1;
        lastCountedAt = now;
        justCountedAt = now;
      } else if (phase === "closed" && ema < lowThresh) {
        // open up but suppressed by refractory
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
      const prev = state.smileEma ?? m.smileAvg;
      const ema = prev * 0.6 + m.smileAvg * 0.4;
      const rise = ema - baseline.smileNeutral;
      const intensity = Math.max(0, Math.min(1, rise / (TH.SMILE_DELTA * 1.5)));

      const smiling =
        rise > TH.SMILE_DELTA &&
        m.jawOpen < TH.JAW_TALKING &&
        ema > m.jawOpen; // smile must dominate over jaw

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
      const yawRel = m.yaw - baseline.yaw;
      const progress = Math.max(0, Math.min(1, (yawRel * targetSign) / TH.YAW_TURN));

      // Parallax: capture initial noseRelZ when user begins turning.
      let pStartZ = state.parallaxStartNoseRelZ;
      let pStartYaw = state.parallaxStartYaw;
      if (pStartZ === undefined && Math.abs(yawRel) > TH.YAW_TURN * 0.25) {
        pStartZ = m.noseRelZ;
        pStartYaw = m.yaw;
      }
      let parallaxOk = state.parallaxOk;
      if (pStartZ !== undefined && pStartYaw !== undefined) {
        const dz = Math.abs(m.noseRelZ - pStartZ);
        const dyaw = Math.abs(m.yaw - pStartYaw);
        if (dyaw > TH.YAW_TURN * 0.6) {
          parallaxOk = dz > TH.PARALLAX_MIN;
        }
      }

      const reached = yawRel * targetSign > TH.YAW_TURN;
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
      const pitchRel = m.pitch - baseline.pitch;
      const progress = Math.max(0, Math.min(1, Math.abs(pitchRel) / TH.PITCH_NOD));
      return {
        ...state,
        poseProgress: progress,
        done: Math.abs(pitchRel) > TH.PITCH_NOD,
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Framing gate
// ─────────────────────────────────────────────────────────────────────────────
export function frameGuidance(
  faces: number,
  m: FaceMetrics | null,
  brightness: number,
): { ok: boolean; text: string } {
  if (faces === 0) return { ok: false, text: "Center your face in the oval" };
  if (faces > 1) return { ok: false, text: "Only one person at a time" };
  if (!m) return { ok: false, text: "Looking for your face…" };
  if (brightness < TH.BRIGHT_MIN) return { ok: false, text: "Too dark — find better lighting" };
  if (m.faceSize < TH.FACE_SIZE_MIN) return { ok: false, text: "Move closer" };
  if (m.faceSize > TH.FACE_SIZE_MAX) return { ok: false, text: "Move back a little" };
  if (m.centerOffset > TH.CENTER_MAX) return { ok: false, text: "Center your face" };
  if (Math.abs(m.yaw) > 0.25 || Math.abs(m.pitch) > 0.25)
    return { ok: false, text: "Face the camera straight on" };
  return { ok: true, text: "Hold still" };
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
