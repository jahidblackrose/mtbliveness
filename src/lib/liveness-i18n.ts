import type { ChallengeKind } from "@/lib/liveness";
import type { GuidanceKey } from "@/lib/liveness";

export type Lang = "bn" | "en";

type Pair = { bn: string; en: string };

export const STRINGS = {
  // Brand / start
  appName: { bn: "লাইভফেস AI", en: "LiveFaceAI" },
  startTitle: { bn: "প্রমাণ করুন এটা আপনিই", en: "Verify it's really you" },
  startSubtitle: {
    bn: "ক্যামেরা ব্যবহার করে দ্রুত লাইভনেস চেক। আপনার ছবি বা ভিডিও কখনো ডিভাইস ছাড়বে না।",
    en: "A quick liveness check using your camera. Your photo and video never leave this device.",
  },
  startBtn: { bn: "শুরু করুন", en: "Start verification" },
  step1: { bn: "ক্যামেরার অনুমতি দিন", en: "Allow camera access" },
  step2: { bn: "ফ্রেমের মাঝে মুখ রাখুন", en: "Center your face in the oval" },
  step3: { bn: "৪টি র‍্যান্ডম কাজ সম্পন্ন করুন", en: "Complete 4 randomized challenges" },

  step4: { bn: "ছবি স্বয়ংক্রিয়ভাবে তোলা হবে", en: "We'll auto-capture your photo" },
  loading: { bn: "ডিভাইসে মডেল লোড হচ্ছে…", en: "Loading on-device model…" },

  // Challenge names (top band primary instruction)
  blinkTwice: { bn: "ধীরে ধীরে দুইবার চোখের পলক ফেলুন", en: "Blink your eyes twice, slowly" },
  smile: { bn: "ক্যামেরার দিকে তাকিয়ে হাসুন", en: "Smile at the camera" },
 turnLeft: { bn: "আস্তে করে বাঁ দিকে তাকান", en: "Gently look to your left" },
 turnRight: { bn: "আস্তে করে ডান দিকে তাকান", en: "Gently look to your right" },
  nod: { bn: "মাথা একবার উপরে-নিচে করুন", en: "Nod your head up and down once" },
  lookUp: { bn: "মাথা উপরে তুলুন", en: "Tilt your head up" },
  lookDown: { bn: "মাথা নিচে নামান", en: "Tilt your head down" },
  mouthOpen: { bn: "মুখ বড় করে হাঁ করুন", en: "Open your mouth wide" },
  mouthOpenHold: { bn: "হাঁ করে রাখুন…", en: "Hold it open…" },
  pitchWrongWay: { bn: "নির্দেশ অনুযায়ী উপরে/নিচে করুন", en: "Follow the instruction — up or down" },
  faceMovedHold: { bn: "মুখ সরে গেছে — সোজা ক্যামেরার দিকে তাকান", en: "Face moved — look straight at the camera" },
  redoLiveness: { bn: "মুখ সরে যাওয়ায় আবার লাইভনেস যাচাই করতে হবে", en: "Face moved — liveness must be re-verified" },
  tooBright: { bn: "অতিরিক্ত আলো — কম আলোয় চেষ্টা করুন", en: "Too bright — reduce the light" },
  whiteBalance: { bn: "সাদা আলো ব্যবহার করুন", en: "Use white lighting" },
  background: { bn: "সাদা ব্যাকগ্রাউন্ডের সামনে দাঁড়ান", en: "Stand against a white background" },
  glare: { bn: "আলোর প্রতিফলন এড়িয়ে চলুন", en: "Avoid glare on your face" },
  occlusion: { bn: "মুখ ঢেকে রাখবেন না", en: "Don't cover your face" },
  eyeLevel: { bn: "ক্যামেরা চোখের সমান উচ্চতায় ধরুন", en: "Hold camera at eye level" },

  // Surprise / unpredictable challenges (Change 1)
  randomSeq: { bn: "করুন: {a}, তারপর {b}", en: "Do: {a}, then {b}" },
  seqIntro: { bn: "দুটি ধাপ — একটির পর একটি করুন", en: "Two quick steps — one after another" },
  seqProgress: { bn: "{n}/{t}", en: "{n}/{t}" },
  seqNext: { bn: "এবার পরেরটি", en: "Now the next one" },
  surpriseHint: { bn: "অপ্রত্যাশিত ধাপ — মনোযোগ দিন", en: "Surprise step — pay attention" },

  // Shoulder / upper-body (Change 3)
  shouldersHint: { bn: "একটু পিছিয়ে যান, কাঁধসহ দেখান", en: "Move back a little so your shoulders are visible" },
  shouldersOk: { bn: "কাঁধ দেখা যাচ্ছে ✓", en: "Shoulders visible ✓" },

  // PAD / replay (Change 4) — advisory
  replayRiskHigh: { bn: "সন্দেহজনক সংকেত — ম্যানুয়াল পর্যালোচনা প্রয়োজন হতে পারে", en: "Suspicious signal — manual review may be required" },
  honestLimits: {
    bn: "এই ব্রাউজার-ভিত্তিক চেকগুলো আক্রমণ কঠিন করে কিন্তু সম্পূর্ণ লাইভনেস নিশ্চিত করে না। সার্ভার চূড়ান্ত যাচাই করবে।",
    en: "These browser checks raise attacker cost but don't certify liveness. The server makes the final decision.",
  },

  // Post-pass capture sequence
  lookStraight: { bn: "সোজা ক্যামেরার দিকে তাকান", en: "Look straight at the camera" },
  hold: { bn: "স্থির থাকুন", en: "Hold still" },
  capturing: { bn: "ছবি তোলা হচ্ছে…", en: "Capturing…" },
  allDone: { bn: "সব ধাপ সম্পন্ন ✓", en: "All steps complete ✓" },
  stepDone: { bn: "ঠিক আছে ✓", en: "Got it ✓" },

  // Guidance (small line)
  center: { bn: "মুখ ফ্রেমের মাঝে আনুন", en: "Bring your face to the center" },
  onePerson: { bn: "একজন করে আসুন", en: "Only one person at a time" },
  searching: { bn: "মুখ খুঁজছি…", en: "Looking for your face…" },
  closer: { bn: "একটু কাছে আসুন", en: "Move a little closer" },
  back: { bn: "একটু পিছিয়ে যান", en: "Move back a little" },
  tooDark: { bn: "আলো বাড়ান, মুখ স্পষ্ট দেখা যাচ্ছে না", en: "More light — your face isn't clear" },
  straight: { bn: "ক্যামেরার দিকে সরাসরি তাকান", en: "Face the camera straight on" },
  holdStill: { bn: "স্থির থাকুন", en: "Hold still" },

  // Counters / meters
  blinkProgress: { bn: "পলক: {n}/২", en: "Blinks: {n}/2" },
  smileHold: { bn: "হাসি ধরে রাখুন…", en: "Hold your smile…" },
  showSmile: { bn: "একটু হাসুন", en: "Show a smile" },
  slowSteady: { bn: "ধীরে স্থিরভাবে", en: "Slow and steady" },




  // Phase headers
  framing: { bn: "ফ্রেমিং", en: "Framing" },
  calibrating: { bn: "ক্যালিব্রেট হচ্ছে", en: "Calibrating" },
  stepOf: { bn: "ধাপ {n}/{t}", en: "Step {n} of {t}" },
  challenge: { bn: "চ্যালেঞ্জ", en: "Challenge" },
  getInFrame: { bn: "ফ্রেমের মধ্যে আসুন", en: "Get into frame" },
  holdStillEllipsis: { bn: "স্থির থাকুন…", en: "Hold still…" },
  allSet: { bn: "প্রস্তুত!", en: "All set!" },

  // Results
  passed: { bn: "সফল হয়েছে ✓", en: "Passed ✓" },
  livenessVerified: { bn: "লাইভনেস যাচাই সম্পন্ন", en: "Liveness verified" },
  capturedAlt: {
    bn: "লাইভনেস চেক উত্তীর্ণ হওয়ার পরে তোলা সেলফি",
    en: "Captured selfie after passing liveness check",
  },
  retake: { bn: "পুনরায় তুলুন", en: "Retake" },
  confirm: { bn: "নিশ্চিত করুন", en: "Confirm" },
  captureSuccess: { bn: "ছবি সফলভাবে নেওয়া হয়েছে ✓", en: "Photo captured successfully ✓" },
  submit: { bn: "জমা দিন", en: "Submit" },
  uploading: { bn: "জমা দেওয়া হচ্ছে…", en: "Submitting…" },
  submitOk: { bn: "যাচাই সম্পন্ন ✓ সফলভাবে জমা হয়েছে", en: "Verification complete ✓ Submitted successfully" },
  submitFail: { bn: "জমা দেওয়া যায়নি। আবার চেষ্টা করুন।", en: "Submission failed. Please try again." },
  retrySubmit: { bn: "আবার চেষ্টা", en: "Retry" },
  videoUnsupported: {
    bn: "এই ব্রাউজারে ভিডিও রেকর্ড করা যায়নি — শুধু ছবি পাঠানো হবে।",
    en: "Video recording isn't supported here — only the photo will be sent.",
  },
  videoLabel: { bn: "শেষ ১০ সেকেন্ডের ভিডিও", en: "Last 10 seconds video" },

  // Errors
  failed: { bn: "যাচাই ব্যর্থ হয়েছে", en: "Verification failed" },
  retry: { bn: "আবার চেষ্টা করুন", en: "Let's try again" },
  back2: { bn: "ফিরে যান", en: "Back" },
  spoof: {
    bn: "ছবি বা স্ক্রিন ব্যবহার করবেন না",
    en: "Don't use a photo or screen",
  },
  permDenied: {
    bn: "ক্যামেরা অনুমতি দেওয়া হয়নি। অনুমতি দিয়ে আবার চেষ্টা করুন।",
    en: "Camera permission was denied. Allow camera access and try again.",
  },
  noCamera: {
    bn: "এই ডিভাইসে কোনো ক্যামেরা পাওয়া যায়নি।",
    en: "No camera was found on this device.",
  },
  timedOut: {
    bn: "সময় শেষ হয়েছে। আবার চেষ্টা করুন।",
    en: "Challenge timed out. Please try again.",
  },
  secondFace: {
    bn: "অন্য মুখ দেখা গেছে। একা চেষ্টা করুন।",
    en: "Another face appeared. Please try again alone.",
  },
  flatSurface: {
    bn: "সমতল পৃষ্ঠ শনাক্ত হয়েছে (ছবি/স্ক্রিন)।",
    en: "Flat surface detected during head turn.",
  },
  noMotion: {
    bn: "কোনো মুভমেন্ট নেই — সম্ভাব্য রিপ্লে।",
    en: "No motion — possible replay.",
  },
  captureFail: {
    bn: "ফ্রেম ক্যাপচার করা যায়নি।",
    en: "Could not capture frame.",
  },

  // Soft timeout / retry / pause / easy mode
  timeoutSoft: { bn: "সময় শেষ। আবার চেষ্টা করুন।", en: "Time's up. Let's try again." },
  paused: { bn: "বিরতি চলছে", en: "Paused" },
  pauseBtn: { bn: "⏸ বিরতি", en: "⏸ Pause" },
  resumeBtn: { bn: "▶ চালু করুন", en: "▶ Resume" },
  tryAgain: { bn: "আবার চেষ্টা করুন", en: "Try again" },
  attempt: { bn: "চেষ্টা {n}/3", en: "Attempt {n}/3" },
  easyModeOn: { bn: "সহজ মোড চালু", en: "Easy mode on" },
  restart: { bn: "শুরু থেকে", en: "Restart" },
  hintBlink: {
    bn: "ক্যামেরার দিকে তাকিয়ে স্বাভাবিকভাবে দুইবার পলক ফেলুন",
    en: "Look at the camera and blink twice naturally",
  },
  hintSmile: {
    bn: "একটু বেশি করে হাসুন এবং ধরে রাখুন",
    en: "Smile a bit wider and hold it",
  },
  hintTurn: {
    bn: "ধীরে ধীরে মাথা ঘোরান, খুব বেশি নয়",
    en: "Turn your head slowly, not too far",
  },
  hintNod: {
    bn: "ধীরে ধীরে মাথা উপর-নিচ করুন",
    en: "Slowly nod your head up and down",
  },
  wrongWay: { bn: "অন্য দিকে ঘোরান", en: "Turn the other way" },
  wrongDir: { bn: "নির্দেশ অনুযায়ী দিক ঠিক করুন", en: "Wrong direction — follow the instruction" },
  turnOtherWay: { bn: "অন্য দিকে ঘোরান", en: "Turn the other way" },
  nodNotSide: { bn: "মাথা উপরে-নিচে করুন, পাশে নয়", en: "Move up-down, not sideways" },
  faceChanged: {
    bn: "মুখ পরিবর্তিত হয়েছে। শুরু থেকে আবার করুন।",
    en: "Face changed — restarting from the beginning.",
  },
  faceMismatch: {
    bn: "যাচাই করা মুখ ও ছবির মুখ মেলেনি। আবার শুরু করুন।",
    en: "Captured face doesn't match the verified face — starting over.",
  },

  // Footer
  disclaimer: {
    bn: "ডেমো — ব্রাউজার-ভিত্তিক লাইভনেস (একক ক্যামেরা সিউডো-ডেপথ)। হার্ডওয়্যার 3D সেন্সরের বিকল্প নয়।",
    en: "Demonstration — browser-based liveness with monocular pseudo-depth. Not a substitute for hardware 3D sensing.",
  },
  cancel: { bn: "বাতিল", en: "Cancel" },
  langLabel: { bn: "বাংলা", en: "English" },

  // Consent (KYC biometric capture)
  consentTitle: { bn: "সম্মতি প্রয়োজন", en: "Consent required" },
  consentBody: {
    bn: "যাচাইয়ের জন্য আপনার ছবি ও ১০ সেকেন্ডের ভিডিও তোলা হবে এবং নির্ধারিত সার্ভারে পাঠানো হবে। সম্মতি ছাড়া ক্যামেরা চালু হবে না।",
    en: "Your photo and a 10-second video will be captured for verification and sent to the configured server. The camera will not start without your consent.",
  },
  consentBodyVoice: {
    bn: "ভয়েস চ্যালেঞ্জ চালু — আপনার মাইক্রোফোনও ব্যবহার করা হবে।",
    en: "Voice challenge is enabled — your microphone will also be used.",
  },
  consentCheckbox: {
    bn: "আমি আমার ছবি, ভিডিও ও মেটাডেটা যাচাইয়ের জন্য পাঠাতে সম্মত",
    en: "I consent to sending my photo, video, and metadata for verification",
  },
  consentContinue: { bn: "সম্মতি দিয়ে এগিয়ে যান", en: "Consent and continue" },
  consentDecline: { bn: "বাতিল", en: "Decline" },

  // Anti-fraud
  tooManyAttempts: {
    bn: "অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।",
    en: "Too many attempts. Please try again later.",
  },
  sessionExpired: {
    bn: "সেশন মেয়াদোত্তীর্ণ। নতুন সেশন শুরু করুন।",
    en: "Session expired. Please start a new session.",
  },
  virtualCameraWarn: {
    bn: "ভার্চুয়াল ক্যামেরা শনাক্ত হতে পারে — আসল ক্যামেরা ব্যবহার করুন।",
    en: "Possible virtual camera detected — please use a real camera.",
  },

  // Voice / lip-sync (advisory; ASR happens server-side)
  sayDigits: {
    bn: "এই সংখ্যাগুলো জোরে পড়ুন: {digits}",
    en: "Read these numbers aloud: {digits}",
  },

  // ── Human-verifier voice script (spoken only) ──
  // Warm greeting at the very first challenge.
  greeting: {
    bn: "চলুন যাচাই করি এটা সত্যিই আপনি। একটু সময় লাগবে।",
    en: "Let's verify it's really you. This will only take a moment.",
  },
  // Brief transition cue between challenges.
  transitionCue: { bn: "এবার পরেরটি…", en: "Now, next…" },
  // Encouraging nudge after ASSIST_AFTER_MS (not scolding).
  almostThere: { bn: "প্রায় হয়ে গেছে — আর একটু।", en: "Almost there — a little more." },
  // Success confirmations after each passed challenge (rotated).
  successAck1: { bn: "চমৎকার।", en: "Great." },
  successAck2: { bn: "ঠিক আছে।", en: "Perfect." },
  successAck3: { bn: "খুব ভালো।", en: "Well done." },
  successAck4: { bn: "হয়ে গেছে।", en: "Got it." },
  // Final ack after the LAST challenge passes.
  finalAck: {
    bn: "সব হয়ে গেছে — এবার সোজা ক্যামেরার দিকে তাকান।",
    en: "All done — now look straight at the camera.",
  },
  // Spoken-only friendly variants per challenge. Screen text stays short
  // (CHALLENGE_KEY), the SPOKEN line is warmer.
  speakBlink: { bn: "এবার দয়া করে দুইবার চোখের পলক ফেলুন।", en: "Now, please blink twice for me." },
  speakSmile: { bn: "এবার একটু হাসুন।", en: "Lovely — now give me a little smile." },
  speakMouthOpen: { bn: "এবার মুখটা বড় করে হাঁ করুন।", en: "Now open your mouth wide, please." },
  speakTurnLeft: { bn: "আস্তে করে মাথাটা বাঁ দিকে ঘোরান।", en: "Gently turn your head to your left." },
  speakTurnRight: { bn: "এবার আস্তে করে ডান দিকে ঘোরান।", en: "And now gently to your right." },
  speakLookUp: { bn: "এবার আস্তে করে মাথাটা উপরে তুলুন।", en: "Now gently tilt your head up." },
  speakLookDown: { bn: "এবার আস্তে করে মাথাটা নিচে নামান।", en: "Now gently tilt your head down." },
  speakNod: { bn: "মাথাটা একবার উপরে-নিচে করুন।", en: "Now nod your head up and down once." },
  speakLookStraight: {
    bn: "চমৎকার। এবার সোজা ক্যামেরার দিকে তাকিয়ে স্থির থাকুন।",
    en: "Perfect. Now look straight at the camera and hold still.",
  },
} as const satisfies Record<string, Pair>;

// Random success-ack picker (rotates across 4 lines per language).
const ACK_KEYS = ["successAck1", "successAck2", "successAck3", "successAck4"] as const;
export function pickSuccessAck(lang: Lang): string {
  const k = ACK_KEYS[Math.floor(Math.random() * ACK_KEYS.length)];
  return STRINGS[k][lang];
}

// Map each challenge to its spoken (warmer) variant key.
// Falls back to the on-screen instruction if not listed.
export const CHALLENGE_SPEAK_KEY: Partial<Record<ChallengeKind, StringKey>> = {
  blink: "speakBlink",
  smile: "speakSmile",
  mouthOpen: "speakMouthOpen",
  turnLeft: "speakTurnLeft",
  turnRight: "speakTurnRight",
  lookUp: "speakLookUp",
  lookDown: "speakLookDown",
  nod: "speakNod",
};



export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: Lang, vars?: Record<string, string | number>) {
  let s: string = STRINGS[key][lang];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export const CHALLENGE_KEY: Record<ChallengeKind, StringKey> = {
  blink: "blinkTwice",
  smile: "smile",
  turnLeft: "turnLeft",
  turnRight: "turnRight",
  nod: "nod",
  lookUp: "lookUp",
  lookDown: "lookDown",
  mouthOpen: "mouthOpen",
  
  randomSequence: "randomSeq",
  readDigits: "sayDigits",
};

export const GUIDANCE_KEY: Record<GuidanceKey, StringKey> = {
  center: "center",
  onePerson: "onePerson",
  searching: "searching",
  tooDark: "tooDark",
  closer: "closer",
  back: "back",
  straight: "straight",
  holdStill: "holdStill",
};

// Per-action SHORT labels used ONLY to inject into composite messages
// (e.g. randomSequence sub-step hint). NOT used as a primary instruction —
// for that, use CHALLENGE_KEY → STRINGS which has the full friendly sentence.
export const ACTION_SHORT: Partial<Record<ChallengeKind, Pair>> = {
  blink: { bn: "চোখের পলক ফেলুন", en: "blink" },
  smile: { bn: "হাসুন", en: "smile" },
  mouthOpen: { bn: "মুখ হাঁ করুন", en: "open your mouth" },
  turnLeft: { bn: "বাঁ দিকে তাকান", en: "look left" },
  turnRight: { bn: "ডান দিকে তাকান", en: "look right" },
  lookUp: { bn: "উপরে তাকান", en: "look up" },
  lookDown: { bn: "নিচে তাকান", en: "look down" },
};
export function actionShort(kind: ChallengeKind, lang: Lang): string {
  const p = ACTION_SHORT[kind];
  return p ? p[lang] : kind;
}
