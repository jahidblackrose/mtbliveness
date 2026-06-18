import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// MediaPipe FaceMesh landmark indices (468-point model).
const LEFT_EYE = { p1: 33, p2: 160, p3: 158, p4: 133, p5: 153, p6: 144 };
const RIGHT_EYE = { p1: 362, p2: 385, p3: 387, p4: 263, p5: 373, p6: 380 };
const NOSE_TIP = 1;
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;
const MOUTH_LEFT = 61;
const MOUTH_RIGHT = 291;
const UPPER_LIP = 13;
const LOWER_LIP = 14;
const FACE_LEFT = 234;
const FACE_RIGHT = 454;
const FACE_TOP = 10;
const FACE_BOTTOM = 152;

type L = NormalizedLandmark;

function dist(a: L, b: L) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function ear(lm: L[], e: typeof LEFT_EYE) {
  const vertical = dist(lm[e.p2], lm[e.p6]) + dist(lm[e.p3], lm[e.p5]);
  const horizontal = 2 * dist(lm[e.p1], lm[e.p4]);
  if (horizontal === 0) return 0;
  return vertical / horizontal;
}

export type FaceMetrics = {
  ear: number;
  yaw: number; // -1 (looking right of camera) .. +1 (left)
  smile: number; // mouth width / face width
  centerOffset: number; // distance of face center to frame center (normalized)
  faceSize: number; // face height / frame height
  box: { x: number; y: number; w: number; h: number }; // normalized
};

export function computeMetrics(lm: L[]): FaceMetrics {
  const leftEAR = ear(lm, LEFT_EYE);
  const rightEAR = ear(lm, RIGHT_EYE);
  const avgEAR = (leftEAR + rightEAR) / 2;

  const eyeMidX = (lm[LEFT_EYE_OUTER].x + lm[RIGHT_EYE_OUTER].x) / 2;
  const faceWidth = Math.max(0.0001, lm[FACE_RIGHT].x - lm[FACE_LEFT].x);
  // Positive yaw: nose is to the LEFT of eye midpoint in image (user turned right).
  // We invert so "turn left" (head left) returns negative, "turn right" positive
  // from the user's perspective — but since video is mirrored we want intuitive:
  // returns >0 when nose shifts toward image right (user's left in mirrored view).
  const yaw = ((lm[NOSE_TIP].x - eyeMidX) / faceWidth) * 2;

  const mouthWidth = dist(lm[MOUTH_LEFT], lm[MOUTH_RIGHT]);
  const mouthOpen = Math.max(0.0001, dist(lm[UPPER_LIP], lm[LOWER_LIP]));
  const smile = mouthWidth / (faceWidth + mouthOpen * 0.1);

  const cx = (lm[FACE_LEFT].x + lm[FACE_RIGHT].x) / 2;
  const cy = (lm[FACE_TOP].y + lm[FACE_BOTTOM].y) / 2;
  const centerOffset = Math.hypot(cx - 0.5, cy - 0.5);
  const faceSize = lm[FACE_BOTTOM].y - lm[FACE_TOP].y;

  const x = lm[FACE_LEFT].x;
  const y = lm[FACE_TOP].y;
  const w = lm[FACE_RIGHT].x - lm[FACE_LEFT].x;
  const h = lm[FACE_BOTTOM].y - lm[FACE_TOP].y;

  return { ear: avgEAR, yaw, smile, centerOffset, faceSize, box: { x, y, w, h } };
}

export type ChallengeKind = "blink" | "turnLeft" | "turnRight" | "smile";

export const CHALLENGE_LABEL: Record<ChallengeKind, string> = {
  blink: "Blink twice",
  turnLeft: "Turn your head LEFT",
  turnRight: "Turn your head RIGHT",
  smile: "Smile",
};

export function pickChallenges(): ChallengeKind[] {
  const pool: ChallengeKind[] = ["blink", "turnLeft", "turnRight", "smile"];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}

// Thresholds tuned for a typical webcam feed.
export const TH = {
  EAR_CLOSED: 0.18,
  EAR_OPEN: 0.25,
  YAW_TURN: 0.35,
  SMILE_BASE: 0.42,
  SMILE_TRIGGER: 0.52,
  CENTER_MAX: 0.18,
  FACE_SIZE_MIN: 0.28,
  FACE_SIZE_MAX: 0.85,
};

export type ChallengeState = {
  kind: ChallengeKind;
  done: boolean;
  // blink: count closed→open cycles
  blinkCount?: number;
  blinkPhase?: "open" | "closed";
  // smile: baseline first observed value
  smileBaseline?: number;
};

export function newChallengeState(kind: ChallengeKind): ChallengeState {
  if (kind === "blink") return { kind, done: false, blinkCount: 0, blinkPhase: "open" };
  return { kind, done: false };
}

export function updateChallenge(state: ChallengeState, m: FaceMetrics): ChallengeState {
  if (state.done) return state;
  switch (state.kind) {
    case "blink": {
      let phase = state.blinkPhase ?? "open";
      let count = state.blinkCount ?? 0;
      if (phase === "open" && m.ear < TH.EAR_CLOSED) phase = "closed";
      else if (phase === "closed" && m.ear > TH.EAR_OPEN) {
        phase = "open";
        count += 1;
      }
      return { ...state, blinkPhase: phase, blinkCount: count, done: count >= 2 };
    }
    case "turnLeft":
      // mirrored video: user's left = image's right = positive yaw in our calc
      return { ...state, done: m.yaw > TH.YAW_TURN };
    case "turnRight":
      return { ...state, done: m.yaw < -TH.YAW_TURN };
    case "smile": {
      const baseline = state.smileBaseline ?? Math.min(m.smile, TH.SMILE_BASE);
      const triggered = m.smile > Math.max(baseline + 0.08, TH.SMILE_TRIGGER);
      return { ...state, smileBaseline: baseline, done: triggered };
    }
  }
}

export function frameGuidance(
  faces: number,
  m: FaceMetrics | null,
  brightness: number,
): { ok: boolean; text: string } {
  if (faces === 0) return { ok: false, text: "Center your face in the oval" };
  if (faces > 1) return { ok: false, text: "Only one person at a time" };
  if (!m) return { ok: false, text: "Looking for your face…" };
  if (brightness < 40) return { ok: false, text: "Too dark — find better lighting" };
  if (m.faceSize < TH.FACE_SIZE_MIN) return { ok: false, text: "Move closer" };
  if (m.faceSize > TH.FACE_SIZE_MAX) return { ok: false, text: "Move back a little" };
  if (m.centerOffset > TH.CENTER_MAX) return { ok: false, text: "Center your face" };
  return { ok: true, text: "Hold still" };
}

export function avgBrightness(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // Sample a small downscaled patch to keep this cheap.
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