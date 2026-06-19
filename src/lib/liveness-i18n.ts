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
  step3: { bn: "২টি র‍্যান্ডম কাজ সম্পন্ন করুন", en: "Complete 2 randomized challenges" },
  almostThere: {
    bn: "প্রায় হয়ে গেছে, আরেকটু",
    en: "Almost there, a little more",
  },
  faceNotClear: {
    bn: "মুখ ভালোভাবে দেখা যাচ্ছে না, আলো বাড়ান",
    en: "Face not clear, improve lighting",
  },

  step4: { bn: "ছবি স্বয়ংক্রিয়ভাবে তোলা হবে", en: "We'll auto-capture your photo" },
  loading: { bn: "ডিভাইসে মডেল লোড হচ্ছে…", en: "Loading on-device model…" },

  // Challenge names (top band primary instruction)
  blinkTwice: { bn: "দুইবার চোখের পলক ফেলুন", en: "Blink twice" },
  smile: { bn: "হাসুন", en: "Smile" },
  turnLeft: { bn: "মাথা বাঁ দিকে ঘোরান", en: "Turn your head left" },
  turnRight: { bn: "মাথা ডান দিকে ঘোরান", en: "Turn your head right" },
  nod: { bn: "মাথা উপর-নিচ করুন", en: "Nod your head" },

  // Guidance (small line)
  center: { bn: "মুখ ফ্রেমের মাঝে রাখুন", en: "Center your face" },
  onePerson: { bn: "একজন করে আসুন", en: "Only one person at a time" },
  searching: { bn: "মুখ খুঁজছি…", en: "Looking for your face…" },
  closer: { bn: "একটু কাছে আসুন", en: "Move closer" },
  back: { bn: "একটু পিছিয়ে যান", en: "Move back" },
  tooDark: { bn: "আলো বাড়ান", en: "Too dark — find better lighting" },
  straight: { bn: "ক্যামেরার দিকে সরাসরি তাকান", en: "Face the camera straight on" },
  holdStill: { bn: "স্থির থাকুন", en: "Hold still" },

  // Counters / meters
  blinkCount: { bn: "পলক: {n}/2", en: "Blinks: {n}/2" },
  keepSmiling: { bn: "হাসি ধরে রাখুন…", en: "Keep smiling…" },
  showSmile: { bn: "একটু হাসুন", en: "Show a smile" },
  slowSteady: { bn: "ধীরে স্থিরভাবে", en: "Slow and steady" },
  nodHint: { bn: "মাথা উপর-নিচ", en: "Up and down" },


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

  // Footer
  disclaimer: {
    bn: "ডেমো — ব্রাউজার-ভিত্তিক লাইভনেস (একক ক্যামেরা সিউডো-ডেপথ)। হার্ডওয়্যার 3D সেন্সরের বিকল্প নয়।",
    en: "Demonstration — browser-based liveness with monocular pseudo-depth. Not a substitute for hardware 3D sensing.",
  },
  cancel: { bn: "বাতিল", en: "Cancel" },
  langLabel: { bn: "বাংলা", en: "English" },
} as const satisfies Record<string, Pair>;


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
