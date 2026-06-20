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

  // ── Re-liveness on movement during capture (Change 1) ──
  FACE_LOST_REDO_MS: 1500,

  // ── Mouth-open challenge (Change 2) ──
  MOUTH_OPEN_HOLD_MS: 250,
  MOUTH_OPEN_DELTA: 0.25,
  MOUTH_OPEN_ABS: 0.40,
  MOUTH_OPEN_SMILE_MAX: 0.7,

  // ── Signed pitch directional (Change 3) ──
  PITCH_ABS: 0.18,
  PITCH_UP_SIGN: -1 as 1 | -1,
  NOD_FULL_CYCLE: false,

  // ── Capture quality / compliance gates (Change 4) ──
  QUALITY_HOLD_MS: 500,
  LUMA_MAX: 235,
  WB_MAX_DELTA: 28,
  BG_MIN_LUMA: 170,
  BG_MAX_STDDEV: 55,
  GLARE_MAX_RATIO: 0.04,
  OCCLUSION_MIN_CONF: 0.6,
  EYE_LEVEL_MAX_PITCH: 0.22,
  EYE_LEVEL_Y_BAND: 0.18,
  QUALITY_SAMPLE_HZ: 10,
} as const;


export const API_ENDPOINT: string =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_LIVENESS_API_ENDPOINT || "https://example.com/api/liveness";

export const API_KEY: string =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_LIVENESS_API_KEY || "";
