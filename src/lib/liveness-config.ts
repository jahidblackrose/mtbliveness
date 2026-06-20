/**
 * Centralized tunable constants for the liveness flow.
 * All timeouts/buffers/thresholds live here so components stay magic-number free.
 * Detection thresholds (`TH`) and easy-mode toggle live in `./liveness`
 * because they are mutated at runtime by the dev panel and easy mode.
 */

export const CONFIG = {
  // ── Challenge timing ──
  CHALLENGE_TIMEOUT_MS: 20_000,
  EASY_CHALLENGE_TIMEOUT_MS: 30_000,
  SESSION_TIMEOUT_MS: 120_000,
  MAX_ATTEMPTS: 3,
  PROMPT_READ_DELAY_MS: 500,
  PROMPT_REACTION_MIN_MS: 250,
  CHALLENGE_BREATHER_MS: 400,

  // ── Framing / calibration ──
  FRAMING_HOLD_MS: 500,
  CALIBRATION_MS: 1500,
  CAPTURE_BUFFER: 5,

  // ── Post-pass capture sequence ──
  SUCCESS_HOLD_MS: 900,
  LOOK_STRAIGHT_HOLD_MS: 500,
  LOOK_STRAIGHT_YAW_MAX: 0.18,
  LOOK_STRAIGHT_PITCH_MAX: 0.18,
  COUNTDOWN_START: 3,
  COUNTDOWN_INTERVAL_MS: 1000,
  FLASH_MS: 200,

  // ── Video / submission ──
  VIDEO_WINDOW_MS: 10_000,
  VIDEO_CHUNK_MS: 1000,
  VIDEO_TRIM_CUSHION_MS: 1000,
  SUBMIT_TIMEOUT_MS: 30_000,

  // ── UI throttling ──
  GUIDANCE_DEBOUNCE_MS: 300,
  READOUT_THROTTLE_MS: 200,
  FPS_REPORT_MS: 1000,

  // ── Anti-fraud / session integrity ──
  CONSENT_TEXT_VERSION: "v1",
  MAX_SESSION_ATTEMPTS: 3,
  NONCE_DEFAULT_TTL_MS: 2 * 60_000,
} as const;


export const API_ENDPOINT: string =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_LIVENESS_API_ENDPOINT || "https://example.com/api/liveness";

export const API_KEY: string =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_LIVENESS_API_KEY || "";
