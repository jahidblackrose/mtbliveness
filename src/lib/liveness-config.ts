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

  // ── 4-challenge selection (Change 1) ──
  CHALLENGE_COUNT: 4,
  COMMON_POOL: ["blink", "smile", "mouthOpen", "turnLeft", "turnRight", "lookUp", "lookDown"] as const,
  SURPRISE_POOL: ["randomSequence", "readDigits"] as const,
  HEAD_KINDS: ["turnLeft", "turnRight", "lookUp", "lookDown"] as const,



  // ── Shoulder / upper-body (Change 3) ──
  SHOULDER_GATE: true,
  SHOULDER_SPAN_RATIO_MIN: 1.4,
  SHOULDER_MOTION_MIN_STDDEV: 0.004,
  POSE_SAMPLE_EVERY_N: 3,

  // ── PAD / replay risk (Change 4) ──
  FLASH_CHALLENGE: false,
  MOIRE_ENERGY_MAX: 0.55,
  FLICKER_SCORE_MAX: 0.45,
  PLANAR_MOTION_MAX: 0.35,
  REPLAY_RISK_THRESHOLD: 0.55,
  REPLAY_RISK_WEIGHTS: {
    "screen-artifact": 0.25,
    "screen-flicker": 0.2,
    "planar-motion": 0.2,
    "flat-surface": 0.1,
    "no-motion": 0.1,
    "flash-mismatch": 0.1,
    "virtualCameraSuspected": 0.15,
  } as Record<string, number>,

  // ── Text-to-speech (voice instructions) ──
  // Web Speech API: device-dependent voice availability. Many phones/laptops
  // lack Bangla TTS; "female Asian" is best-effort with fallbacks.
  // Upgrade path for guaranteed voice: pre-recorded audio clips or a cloud
  // TTS API (Google/Azure/ElevenLabs). Not implemented now.
  TTS_ENABLED: true,
  TTS_RATE: 0.98,
  TTS_PITCH: 1.05,
  TTS_PREFER_LOCALES_BN: ["bn-BD", "bn-IN", "bn", "hi-IN"] as const,
  TTS_PREFER_LOCALES_EN: ["en-IN", "en-SG", "en-PH", "en-HK", "en-AU", "en-GB", "en-US", "en"] as const,
  TTS_FEMALE_NAME_HINTS: [
    "female", "woman",
    "heera", "kalpana", "swara", "aditi", "raveena", "veena", "priya", "neerja", "asha",
    "google हिन्दी", "google বাংলা", "google bangla", "google bengali", "google hindi",
    "samantha", "karen", "tessa", "victoria", "fiona", "moira", "serena", "zira",
  ] as const,
  TTS_MALE_NAME_HINTS: ["male", "rishi", "ravi", "daniel", "alex", "fred", "george"] as const,
} as const;


export const API_ENDPOINT: string =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_LIVENESS_API_ENDPOINT || "https://example.com/api/liveness";

export const API_KEY: string =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_LIVENESS_API_KEY || "";
