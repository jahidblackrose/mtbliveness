/**
 * Anti-fraud / audit metadata helpers for LiveFaceAI.
 *
 * IMPORTANT: every signal computed here is ADVISORY ONLY. The user controls
 * the browser and camera — heuristics like virtual-camera detection or
 * client-side hashing can be bypassed. The server is the final authority
 * and must independently re-verify the submitted media + nonce.
 */

import type { ChallengeKind } from "@/lib/liveness";

// ── Hashing ─────────────────────────────────────────────────────────────
export async function sha256Blob(blob: Blob): Promise<string | null> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return hex;
  } catch {
    return null;
  }
}

// ── Device / capability snapshot ────────────────────────────────────────
export type DeviceInfo = {
  userAgent: string;
  platform: string;
  language: string;
  timezone: string;
  screen: { w: number; h: number; dpr: number };
};
export function collectDeviceInfo(): DeviceInfo {
  const nav = typeof navigator !== "undefined" ? navigator : ({} as Navigator);
  const scr = typeof window !== "undefined" ? window.screen : ({ width: 0, height: 0 } as Screen);
  return {
    userAgent: nav.userAgent ?? "",
    platform: nav.platform ?? "",
    language: nav.language ?? "",
    timezone: Intl?.DateTimeFormat?.().resolvedOptions().timeZone ?? "",
    screen: {
      w: scr.width ?? 0,
      h: scr.height ?? 0,
      dpr: typeof window !== "undefined" ? window.devicePixelRatio ?? 1 : 1,
    },
  };
}

// ── Virtual-camera detection (heuristic) ────────────────────────────────
const VIRTUAL_CAMERA_PATTERNS = [
  /obs/i, /manycam/i, /virtual/i, /snap\s*camera/i, /xsplit/i,
  /droidcam/i, /epoccam/i, /ndi/i, /iVCam/i, /reincubate/i, /e2esoft/i,
];
export type CameraInspection = {
  label: string;
  virtualCameraSuspected: boolean;
  settings: MediaTrackSettings | null;
  capabilities: MediaTrackCapabilities | null;
};
export function inspectCamera(stream: MediaStream | null): CameraInspection {
  const track = stream?.getVideoTracks()?.[0] ?? null;
  const label = track?.label ?? "";
  let settings: MediaTrackSettings | null = null;
  let capabilities: MediaTrackCapabilities | null = null;
  try { settings = track?.getSettings() ?? null; } catch { /* ignore */ }
  try { capabilities = (track && "getCapabilities" in track) ? track.getCapabilities() : null; } catch { /* ignore */ }
  const virtualCameraSuspected = VIRTUAL_CAMERA_PATTERNS.some((p) => p.test(label));
  return { label, virtualCameraSuspected, settings, capabilities };
}

// ── Nonce-derived determinism (anti-replay) ─────────────────────────────
// Simple deterministic 32-bit hash so the same nonce yields the same order.
function strHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickChallengesFromNonce(nonce: string, includeVoice = false): ChallengeKind[] {
  const rng = mulberry32(strHash(nonce));
  const shuffle = <T>(arr: T[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];

  // 2 easy from {blink, smile, mouthOpen}
  const easy: ChallengeKind[] = ["blink", "smile", "mouthOpen"];
  shuffle(easy);
  const easyPicked = easy.slice(0, 2);

  // 1 single easy head turn
  const head = pick<ChallengeKind>(["turnLeft", "turnRight"]);

  // 1 surprise — randomSequence (+ readDigits if voice on). followDot removed.
  // If voice off and surprise pool ends up empty for some reason, fall back to easy.
  const surprisePool: ChallengeKind[] = includeVoice
    ? ["randomSequence", "readDigits"]
    : ["randomSequence"];
  const surprise = surprisePool.length ? pick(surprisePool) : pick(easy);

  const base: ChallengeKind[] = [easyPicked[0], easyPicked[1], head, surprise];
  shuffle(base);
  return base.slice(0, 4);
}

export function digitsFromNonce(nonce: string, n = 4): string {
  const rng = mulberry32(strHash(`${nonce}:digits`));
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(rng() * 10).toString();
  return s;
}

// Deterministic 2-action pair for the randomSequence challenge.
// Same nonce → same pair AND same order, so the server can re-derive + verify.
export function seqActionsFromNonce(nonce: string): [ChallengeKind, ChallengeKind] {
  const rng = mulberry32(strHash(`${nonce}:seq`));
  const easy: ChallengeKind[] = ["blink", "smile", "mouthOpen"];
  const head: ChallengeKind[] = ["turnLeft", "turnRight"];
  const pickFrom = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
  const first = pickFrom(easy);
  const useHead = rng() < 0.3;
  let second: ChallengeKind;
  if (useHead) second = pickFrom(head);
  else {
    const rem = easy.filter((k) => k !== first);
    second = pickFrom(rem.length ? rem : easy);
  }
  return [first, second];
}

// ── Session parsing (URL-based, host-app provided) ──────────────────────
export type SessionParams = {
  nonce: string | null;
  nonceIssuedAt: number | null;
  expiresAt: number | null;
  challengesFromHost: ChallengeKind[] | null;
  enableVoice: boolean;
};
const KIND_WHITELIST = new Set<ChallengeKind>(["blink", "smile", "turnLeft", "turnRight", "nod", "lookUp", "lookDown", "mouthOpen", "randomSequence", "readDigits"]);
export function readSessionFromUrl(search: string): SessionParams {
  const p = new URLSearchParams(search);
  const nonce = p.get("nonce");
  const issued = Number(p.get("issued"));
  const exp = Number(p.get("exp"));
  const rawChallenges = p.get("challenges");
  const challengesFromHost = rawChallenges
    ? (rawChallenges.split(",").map((s) => s.trim()).filter((s) => KIND_WHITELIST.has(s as ChallengeKind)) as ChallengeKind[])
    : null;
  return {
    nonce: nonce || null,
    nonceIssuedAt: Number.isFinite(issued) && issued > 0 ? issued : null,
    expiresAt: Number.isFinite(exp) && exp > 0 ? exp : null,
    challengesFromHost: challengesFromHost && challengesFromHost.length ? challengesFromHost : null,
    enableVoice: p.get("voice") === "1" || p.get("voice") === "true",
  };
}

export function isNonceStale(params: SessionParams, now = Date.now()): boolean {
  if (!params.nonce) return false; // no nonce → host didn't bind a session; not "stale"
  if (params.expiresAt != null) return now > params.expiresAt;
  if (params.nonceIssuedAt != null) return now - params.nonceIssuedAt > 2 * 60_000;
  return false;
}
