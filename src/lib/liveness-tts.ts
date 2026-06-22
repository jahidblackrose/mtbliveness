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
let pending: Array<{ text: string; lang: Lang }> = [];
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

export function isSpeaking(): boolean {
  return speaking;
}

function setSpeaking(v: boolean): void {
  if (speaking === v) return;
  speaking = v;
  for (const l of speakingListeners) { try { l(v); } catch { /* ignore */ } }
  if (!v) {
    lastEndedAt = Date.now();
    for (const l of [...endListeners]) { try { l(); } catch { /* ignore */ } }
  }
}

export function onSpeakingChange(l: (s: boolean) => void): () => void {
  speakingListeners.add(l);
  return () => { speakingListeners.delete(l); };
}

export function cancelSpeak(): void {
  pending = [];
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  if (!supported()) { setSpeaking(false); return; }
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  lastSpoken = "";
  setSpeaking(false);
}

function rateFor(lang: Lang): number {
  return lang === "bn" ? CONFIG.TTS_RATE_BN : CONFIG.TTS_RATE_EN;
}

function speakNow(text: string, lang: Lang): void {
  if (!supported() || muted) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    const voice = resolveVoice(lang);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = lang === "bn" ? "bn-BD" : "en-IN";
    }
    u.rate = rateFor(lang);
    u.pitch = CONFIG.TTS_PITCH;
    u.volume = 1;
    u.onstart = () => setSpeaking(true);
    const finish = () => {
      setSpeaking(false);
      // Drain next queued utterance after a natural gap.
      if (pending.length && !muted) {
        const next = pending.shift()!;
        if (pendingTimer) { clearTimeout(pendingTimer); }
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          speakNow(next.text, next.lang);
        }, CONFIG.TTS_GAP_MS);
      }
    };
    u.onend = finish;
    u.onerror = finish;
    setSpeaking(true); // optimistic; some browsers fire onstart late
    window.speechSynthesis.speak(u);
  } catch { setSpeaking(false); }
}

/**
 * Speak a sentence. Fire-and-forget; never throws and never blocks.
 * If something is already speaking, the newest request REPLACES any
 * existing single-item queue so messages don't pile up or get cut off.
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
  if (speaking) {
    pending = [{ text: trimmed, lang }];
    return;
  }
  speakNow(trimmed, lang);
}

/**
 * Speak a SEQUENCE of lines back-to-back with TTS_GAP_MS between each.
 * Use for the 3-beat handoff: success ack → transition cue → new instruction.
 * Cancels any currently-pending single utterance so the sequence is atomic.
 */
export function speakSequence(items: Array<{ text: string; lang: Lang }>): void {
  if (!supported() || muted) return;
  const cleaned = items
    .map((i) => ({ text: (i.text || "").trim(), lang: i.lang }))
    .filter((i) => i.text.length > 0);
  if (!cleaned.length) return;
  // Reset dedup so the sequence's first line always speaks.
  lastSpoken = "";
  lastSpokenAt = 0;
  const [first, ...rest] = cleaned;
  pending = rest;
  if (speaking) {
    // Replace whatever was queued with our new sequence; current utterance
    // finishes naturally, then onend drains our queue.
    pending = cleaned;
    return;
  }
  speakNow(first.text, first.lang);
}

/**
 * Wait until the current and ALL queued utterances finish plus a small gap.
 * Resolves immediately if nothing is speaking, or after maxWaitMs as a
 * safety cap so callers never hang when speech is unavailable.
 */
export function waitUntilSpoken(maxWaitMs: number = CONFIG.TTS_MAX_WAIT_MS): Promise<void> {
  if (!supported() || muted) return Promise.resolve();
  if (!speaking && pending.length === 0) {
    const sinceEnd = Date.now() - lastEndedAt;
    const wait = Math.max(0, CONFIG.TTS_GAP_MS - sinceEnd);
    return wait === 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, wait));
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      endListeners.delete(handler);
      clearTimeout(cap);
      resolve();
    };
    const handler = () => {
      setTimeout(() => {
        if (!speaking && pending.length === 0) finish();
      }, CONFIG.TTS_GAP_MS);
    };
    endListeners.add(handler);
    const cap = setTimeout(finish, Math.max(0, maxWaitMs));
  });
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
