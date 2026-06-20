/**
 * Lightweight upper-body / shoulder presence check (Change 3, Phase C).
 *
 * Wraps MediaPipe PoseLandmarker. Lazy-loaded — only initialised when the
 * caller actually invokes `getPoseDetector()`. Designed to run at a lower
 * cadence than the main face loop (e.g. every 3rd–4th frame) so it doesn't
 * tank FPS.
 *
 * USAGE (opt-in, advisory):
 *   const pose = await getPoseDetector();
 *   if (frame % CONFIG.POSE_SAMPLE_EVERY_N === 0) {
 *     const r = pose.detectForVideo(videoEl, performance.now());
 *     const info = analyseShoulders(r, faceWidthPx);
 *     meta.upperBody = info;
 *   }
 *
 * IMPORTANT: this signal is ADVISORY. A face-only setup is legitimate;
 * `CONFIG.SHOULDER_GATE` lets the host disable it per channel.
 */

import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from "@mediapipe/tasks-vision";

let _detector: PoseLandmarker | null = null;
let _loading: Promise<PoseLandmarker> | null = null;

export async function getPoseDetector(): Promise<PoseLandmarker> {
  if (_detector) return _detector;
  if (_loading) return _loading;
  _loading = (async () => {
    const fileset = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm",
    );
    const det = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    _detector = det;
    return det;
  })();
  return _loading;
}

export type UpperBodyInfo = {
  shouldersVisible: boolean;
  shoulderSpanRatio: number; // shoulder span / face width
  shoulderMotionOk: boolean | null; // null until enough samples
};

// COCO/MediaPipe pose indices: 11 = left shoulder, 12 = right shoulder.
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;

const _yHistory: number[] = [];
const HISTORY_MAX = 30;

export function analyseShoulders(
  result: PoseLandmarkerResult | null,
  faceWidthNorm: number, // face bbox width in normalised [0..1] coords
  shoulderSpanRatioMin = 1.4,
  shoulderMotionMinStddev = 0.004,
): UpperBodyInfo {
  const lm = result?.landmarks?.[0];
  if (!lm || lm.length <= RIGHT_SHOULDER) {
    return { shouldersVisible: false, shoulderSpanRatio: 0, shoulderMotionOk: null };
  }
  const L = lm[LEFT_SHOULDER];
  const R = lm[RIGHT_SHOULDER];
  const visible =
    (L.visibility ?? 1) > 0.5 && (R.visibility ?? 1) > 0.5;
  const span = Math.abs(L.x - R.x);
  const ratio = faceWidthNorm > 0 ? span / faceWidthNorm : 0;
  const shouldersVisible = visible && ratio >= shoulderSpanRatioMin;

  // Track midpoint Y for micro-motion (Δy stddev). Rigid printed photo → ~0.
  const midY = (L.y + R.y) / 2;
  _yHistory.push(midY);
  if (_yHistory.length > HISTORY_MAX) _yHistory.shift();
  let motionOk: boolean | null = null;
  if (_yHistory.length >= 10) {
    const mean = _yHistory.reduce((a, b) => a + b, 0) / _yHistory.length;
    const variance =
      _yHistory.reduce((a, b) => a + (b - mean) * (b - mean), 0) / _yHistory.length;
    const std = Math.sqrt(variance);
    motionOk = std >= shoulderMotionMinStddev;
  }
  return { shouldersVisible, shoulderSpanRatio: ratio, shoulderMotionOk: motionOk };
}

export function resetShoulderHistory() {
  _yHistory.length = 0;
}
