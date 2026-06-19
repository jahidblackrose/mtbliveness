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
  step3: { bn: "৩টি র‍্যান্ডম কাজ সম্পন্ন করুন", en: "Complete 3 randomized challenges" },

  step4: { bn: "ছবি স্বয়ংক্রিয়ভাবে তোলা হবে", en: "We'll auto-capture your photo" },
  loading: { bn: "ডিভাইসে মডেল লোড হচ্ছে…", en: "Loading on-device model…" },

  // Challenge names (top band primary instruction)
  blinkTwice: { bn: "ধীরে ধীরে দুইবার চোখের পলক ফেলুন", en: "Blink your eyes twice, slowly" },
  smile: { bn: "ক্যামেরার দিকে তাকিয়ে হাসুন", en: "Smile at the camera" },
  turnLeft: { bn: "ধীরে মাথা বাঁ দিকে ঘোরান", en: "Slowly turn your head left" },
  turnRight: { bn: "ধীরে মাথা ডান দিকে ঘোরান", en: "Slowly turn your head right" },
  nod: { bn: "মাথা একবার উপরে-নিচে করুন", en: "Nod your head up and down once" },

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
