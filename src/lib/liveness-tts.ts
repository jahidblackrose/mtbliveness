// Browser-built-in TTS via Web Speech API.
//
// HONEST NOTE: Voice availability is DEVICE-DEPENDENT. Many phones/laptops
// have no Bangla TTS voice, and "female Asian" cannot be guaranteed
// everywhere. We do best-effort with fallbacks; for guaranteed consistent
// voices on all devices, the upgrade path is pre-recorded audio clips per
// language OR a cloud TTS API (Google/Azure/ElevenLabs).

import { CONFIG } from "@/lib/liveness-config";
import type { Lang } from "@/lib/liveness-i18n";

type Listener = (voice: SpeechSynthesisVoice | null, lang: Lang) => void;

let muted = false;
let lastSpoken = "";
let lastSpokenAt = 0;
let speaking = false;
let lastEndedAt = 0;
let pending: { text: string; lang: Lang } | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
const speakingListeners = new Set<(s: boolean) => void>();
const endListeners = new Set<() => void>();
const listeners = new Set<Listener>();
const cache = new Map<Lang, SpeechSynthesisVoice | null>();

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance !== "undefined" &&
    CONFIG.TTS_ENABLED
  );
}

function allVoices(): SpeechSynthesisVoice[] {
  if (!supported()) return [];
  try {
    return window.speechSynthesis.getVoices() ?? [];
  } catch {
    return [];
  }
}

function isFemale(name: string): boolean {
  const n = name.toLowerCase();
  if (CONFIG.TTS_MALE_NAME_HINTS.some((h) => n.includes(h))) return false;
  return CONFIG.TTS_FEMALE_NAME_HINTS.some((h) => n.includes(h));
}

function pickFor(lang: Lang): SpeechSynthesisVoice | null {
  const voices = allVoices();
  if (!voices.length) return null;
  const prefer = lang === "bn" ? CONFIG.TTS_PREFER_LOCALES_BN : CONFIG.TTS_PREFER_LOCALES_EN;
  const norm = (s: string) => s.toLowerCase().replace("_", "-");
  for (const loc of prefer) {
    const l = loc.toLowerCase();
    const inLocale = voices.filter((v) => {
      const vl = norm(v.lang);
      return vl === l || vl.startsWith(l + "-") || vl.startsWith(l);
    });
    if (!inLocale.length) continue;
    const female = inLocale.find((v) => isFemale(v.name));
    if (female) return female;
    // skip known males then accept first
    const notMale = inLocale.find(
      (v) => !CONFIG.TTS_MALE_NAME_HINTS.some((h) => v.name.toLowerCase().includes(h)),
    );
    return notMale ?? inLocale[0];
  }
  // last-resort: any female voice, else first available
  const anyFemale = voices.find((v) => isFemale(v.name));
  return anyFemale ?? voices[0] ?? null;
}

function resolveVoice(lang: Lang): SpeechSynthesisVoice | null {
  if (cache.has(lang)) return cache.get(lang) ?? null;
  const v = pickFor(lang);
  if (v) cache.set(lang, v);
  return v;
}

if (typeof window !== "undefined" && supported()) {
  const onChange = () => {
    cache.clear();
    // warm cache + notify listeners for current preferences
    for (const lang of ["bn", "en"] as Lang[]) resolveVoice(lang);
    for (const l of listeners) {
      try { l(resolveVoice("bn"), "bn"); } catch { /* ignore */ }
    }
  };
  try {
    window.speechSynthesis.onvoiceschanged = onChange;
  } catch { /* ignore */ }
  // kick a load
  try { window.speechSynthesis.getVoices(); } catch { /* ignore */ }
}

export function setMuted(v: boolean): void {
  muted = v;
  if (v) cancelSpeak();
}

export function isMuted(): boolean {
  return muted;
}

export function cancelSpeak(): void {
  if (!supported()) return;
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  lastSpoken = "";
}

/**
 * Speak a sentence. Fire-and-forget; never throws and never blocks.
 * Cancels any in-flight utterance so prompts don't overlap.
 * De-dupes the same string within 1.2s to avoid repeats from re-renders.
 */
export function speak(text: string, lang: Lang): void {
  if (!supported() || muted) return;
  const trimmed = (text || "").trim();
  if (!trimmed) return;
  const now = Date.now();
  if (trimmed === lastSpoken && now - lastSpokenAt < 1200) return;
  lastSpoken = trimmed;
  lastSpokenAt = now;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(trimmed);
    const voice = resolveVoice(lang);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = lang === "bn" ? "bn-BD" : "en-IN";
    }
    u.rate = CONFIG.TTS_RATE;
    u.pitch = CONFIG.TTS_PITCH;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

export function getSelectedVoice(lang: Lang): SpeechSynthesisVoice | null {
  return resolveVoice(lang);
}

export function listVoices(): SpeechSynthesisVoice[] {
  return allVoices();
}

export function onVoicesReady(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
