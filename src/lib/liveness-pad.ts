/**
 * Presentation Attack Detection (PAD) signals (Change 4, Phase D).
 *
 * All functions are PURE and run on small downscaled crops to stay real-time.
 * Each returns a 0..1 score (higher = more suspicious). Aggregate via
 * `replayRiskScore()` — the result is ADVISORY only and is recorded in
 * `meta.spoofFlags` + `meta.replayRisk`. The server makes the final call.
 *
 * Honest limits: these heuristics raise attacker cost but do NOT certify
 * liveness. Deepfake-grade texture analysis and true 3D/ToF depth require a
 * certified native SDK (see `certifiedDepthAdapter` hook).
 */

// ── Moiré / screen-grid energy ──────────────────────────────────────────
// Sample a 64×64 grayscale crop of the face; sum the high-frequency band
// of a cheap 1-D DCT along each row + col. A real face has smooth gradients
// → low HF energy. A screen photographed by a camera shows regular pixel-grid
// patterns (moiré) → elevated HF energy.
export function moireEnergy(gray: Uint8ClampedArray, w: number, h: number): number {
  // 1-D DCT-II approximation via difference operator (Laplacian-like HF sum).
  // We're not running a real FFT to keep per-frame cost tiny; the relative
  // ranking between a face and a screen is what matters here.
  let hf = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      hf += Math.abs(lap);
      n++;
    }
  }
  // Normalise to [0..1] empirically: 12 was the rough mid-point in testing.
  const avg = hf / Math.max(1, n) / 12;
  return Math.min(1, avg);
}

// ── Brightness flicker (display refresh) ────────────────────────────────
// Maintain a rolling brightness series; periodic flicker (50/60Hz beating)
// gives a high autocorrelation peak at small lags. Real ambient light tends
// to be more uniform on these short windows.
export function flickerScore(brightnessHistory: number[]): number {
  const n = brightnessHistory.length;
  if (n < 16) return 0;
  const mean = brightnessHistory.reduce((a, b) => a + b, 0) / n;
  let varSum = 0;
  for (const b of brightnessHistory) varSum += (b - mean) * (b - mean);
  const variance = varSum / n;
  if (variance < 1e-6) return 0;
  // Autocorrelation at small lag (1..3 frames ~ display beat).
  let maxAc = 0;
  for (let lag = 1; lag <= 3; lag++) {
    let ac = 0;
    for (let i = 0; i < n - lag; i++) {
      ac += (brightnessHistory[i] - mean) * (brightnessHistory[i + lag] - mean);
    }
    ac /= (n - lag) * variance;
    if (ac > maxAc) maxAc = ac;
  }
  return Math.max(0, Math.min(1, maxAc));
}

// ── Planar / rigid motion (complements parallax) ────────────────────────
// During a head movement, a real 3D face shows variance in per-region motion
// (nose moves further than ears). A flat printed photo or screen shows all
// regions translating together → very low local-motion variance.
//
// Caller passes per-region displacement magnitudes (e.g. nose, left cheek,
// right cheek, forehead, chin between two frames).
export function planarMotionScore(regionDeltas: number[]): number {
  if (regionDeltas.length < 3) return 0;
  const mean = regionDeltas.reduce((a, b) => a + b, 0) / regionDeltas.length;
  if (mean < 0.001) return 0; // no motion → not a planar signal yet
  let v = 0;
  for (const d of regionDeltas) v += (d - mean) * (d - mean);
  const std = Math.sqrt(v / regionDeltas.length);
  const cv = std / mean; // coefficient of variation
  // Real face cv ~ 0.4+; flat surface cv ~ 0.05. Map low cv → high score.
  return Math.max(0, Math.min(1, 1 - cv / 0.4));
}

// ── Flash mismatch (optional, off by default) ────────────────────────────
// If the host briefly tints the screen blue/white/red and measures the face's
// per-channel brightness response, a real face responds proportionally while
// a replayed screen shows a damped / shifted response.
export function flashMismatchScore(
  beforeRGB: [number, number, number],
  afterRGB: [number, number, number],
  expectedDeltaChannel: 0 | 1 | 2, // which channel the flash boosted
): number {
  const dr = afterRGB[0] - beforeRGB[0];
  const dg = afterRGB[1] - beforeRGB[1];
  const db = afterRGB[2] - beforeRGB[2];
  const expected = [dr, dg, db][expectedDeltaChannel];
  const others = [dr, dg, db].filter((_, i) => i !== expectedDeltaChannel);
  const otherMag = Math.max(...others.map(Math.abs));
  if (expected < 4) return 1; // no response → very suspicious
  const ratio = otherMag / expected;
  return Math.max(0, Math.min(1, ratio));
}

// ── Aggregate replay-risk score ─────────────────────────────────────────
export type SpoofFlag =
  | "screen-artifact"
  | "screen-flicker"
  | "planar-motion"
  | "flat-surface"
  | "no-motion"
  | "flash-mismatch"
  | "virtualCameraSuspected";

export function replayRiskScore(
  flags: Partial<Record<SpoofFlag, number>>,
  weights: Record<string, number>,
): number {
  let total = 0;
  let wsum = 0;
  for (const [k, score] of Object.entries(flags)) {
    if (score == null) continue;
    const w = weights[k] ?? 0;
    total += w * Math.max(0, Math.min(1, score));
    wsum += w;
  }
  if (wsum === 0) return 0;
  // Don't divide by wsum — preserve absolute scale so a single strong flag
  // can push past threshold. Cap at 1.
  return Math.min(1, total);
}

export function activeFlags(
  flags: Partial<Record<SpoofFlag, number>>,
  threshold = 0.5,
): SpoofFlag[] {
  const out: SpoofFlag[] = [];
  for (const [k, v] of Object.entries(flags)) {
    if (v != null && v >= threshold) out.push(k as SpoofFlag);
  }
  return out;
}
