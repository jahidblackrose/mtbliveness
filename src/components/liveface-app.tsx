
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { Camera, CheckCircle2, Languages, Pause, Play, RotateCcw, ShieldCheck, Settings, Volume2, VolumeX, X } from "lucide-react";
import {
  speak as ttsSpeak,
  cancelSpeak as ttsCancel,
  setMuted as ttsSetMuted,
  getSelectedVoice as ttsGetVoice,
  listVoices as ttsListVoices,
  onVoicesReady as ttsOnReady,
} from "@/lib/liveness-tts";
import { Button } from "@/components/ui/button";
import {
  type ChallengeState,
  type ChallengeKind,
  type Baseline,
  type FaceMetrics,
  type CalibAccumulator,
  type FaceSignature,
  computeMetrics,
  computeSignature,
  avgSignatures,
  signatureSimilarity,
  INTEGRITY,
  frameGuidance,
  newChallengeState,
  pickChallenges,
  updateChallenge,
  inspectHeadGesture,
  avgBrightness,
  accumulate,
  finalizeBaseline,
  emptyAccumulator,
  setEasyMode,
  EASY,
  TH,
  DIRECTION,
  resetDirectionCalibration,
  resetPitchCalibration,
  SpoofGuard,
} from "@/lib/liveness";
import {
  CHALLENGE_KEY,
  GUIDANCE_KEY,
  type Lang,
  t,
  actionShort,
} from "@/lib/liveness-i18n";
import { ChallengeDemo } from "@/components/challenge-demo";
import { getPoseDetector, analyseShoulders, type UpperBodyInfo } from "@/lib/liveness-pose";
import {
  moireEnergy,
  flickerScore,
  replayRiskScore,
  activeFlags,
  type SpoofFlag,
} from "@/lib/liveness-pad";


import { API_ENDPOINT, API_KEY, CONFIG } from "@/lib/liveness-config";
import {
  sha256Blob,
  collectDeviceInfo,
  inspectCamera,
  pickChallengesFromNonce,
  seqActionsFromNonce,
  digitsFromNonce,
  readSessionFromUrl,
  isNonceStale,
  type SessionParams,
  type CameraInspection,
} from "@/lib/liveness-meta";

type Step = "start" | "consent" | "loading" | "framing" | "calibrating" | "liveness" | "result" | "error" | "blocked";



function pickVideoMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch { /* ignore */ }
  }
  return undefined;
}

type VideoChunk = { ts: number; blob: Blob };


export function LiveFaceAI() {
  const [lang, setLang] = useState<Lang>("bn");
  const langRef = useRef<Lang>("bn");
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  // ── Spoken voice instructions (TTS) ──
  const [ttsMuted, setTtsMuted] = useState<boolean>(false);
  const [ttsVoiceLabel, setTtsVoiceLabel] = useState<string>("—");
  useEffect(() => {
    ttsSetMuted(ttsMuted);
  }, [ttsMuted]);
  useEffect(() => {
    const refresh = () => {
      const v = ttsGetVoice(langRef.current);
      setTtsVoiceLabel(v ? `${v.name} · ${v.lang}` : "—");
    };
    refresh();
    const off = ttsOnReady(refresh);
    return () => { off(); ttsCancel(); };
  }, []);
  useEffect(() => {
    const v = ttsGetVoice(lang);
    setTtsVoiceLabel(v ? `${v.name} · ${v.lang}` : "—");
  }, [lang]);
  const sayKey = useCallback(
    (k: Parameters<typeof t>[0], vars?: Record<string, string | number>) => {
      if (ttsMuted) return;
      try { ttsSpeak(t(k, langRef.current, vars), langRef.current); } catch { /* ignore */ }
    },
    [ttsMuted],
  );
  const tx = useCallback(
    (k: Parameters<typeof t>[0], vars?: Record<string, string | number>) => t(k, lang, vars),
    [lang],
  );

  const [step, setStep] = useState<Step>("start");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);

  const challengesRef = useRef<ChallengeState[]>([]);
  const [challengeView, setChallengeView] = useState<ChallengeState[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [guidanceText, setGuidanceText] = useState<string>("");
  const lastGuidanceChangeRef = useRef<number>(0);
  const guidanceDraftRef = useRef<string>("");
  const [centered, setCentered] = useState(false);
  // (legacy in-camera countdown removed — use bigCountdown for post-pass 3-2-1)
  const [timeLeft, setTimeLeft] = useState<number>(CONFIG.CHALLENGE_TIMEOUT_MS);
  const [flash, setFlash] = useState(false);
  const [blinkTick, setBlinkTick] = useState(0);
  const stepRef = useRef<Step>("start");

  // ── MediaRecorder rolling buffer (last ~10s) ──
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderMimeRef = useRef<string | undefined>(undefined);
  const chunksRef = useRef<VideoChunk[]>([]);
  const [videoSupported, setVideoSupported] = useState(true);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const sessionMetaRef = useRef<{ sessionId: string; startedAt: number } | null>(null);

  // ── Session binding (host-provided nonce + voice flag, from URL) ──
  const sessionParamsRef = useRef<SessionParams>({
    nonce: null, nonceIssuedAt: null, expiresAt: null, challengesFromHost: null, enableVoice: false,
  });
  const consentRef = useRef<{ given: boolean; timestamp: number | null; textVersion: string }>({
    given: false, timestamp: null, textVersion: CONFIG.CONSENT_TEXT_VERSION,
  });
  const sessionAttemptsRef = useRef<number>(0);
  const challengeTimelineRef = useRef<{ idx: number; kind: string; startedAt: number; completedAt: number | null }[]>([]);
  const cameraInspectionRef = useRef<CameraInspection | null>(null);
  const digitsRef = useRef<string>("");
  const [digitsForVoice, setDigitsForVoice] = useState<string>("");

  type SubmitState = "idle" | "uploading" | "ok" | "fail";
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitError, setSubmitError] = useState<string>("");


  const framingHoldStartRef = useRef<number | null>(null);

  const calibAccRef = useRef<CalibAccumulator>(emptyAccumulator());
  const calibStartRef = useRef<number>(0);
  const baselineRef = useRef<Baseline | null>(null);
  const [calibProgress, setCalibProgress] = useState(0);

  const challengeStartRef = useRef<number>(0);
  const challengePromptedAtRef = useRef<number>(0);
  const breatherUntilRef = useRef<number>(0);

  const [blinkMeter, setBlinkMeter] = useState(0);
  const [smileMeter, setSmileMeter] = useState(0);
  const [poseMeter, setPoseMeter] = useState(0);

  const captureBufRef = useRef<{ ts: number; brightness: number; centered: boolean }[]>([]);
  const spoofRef = useRef<SpoofGuard>(new SpoofGuard());

  // ── New: pause / soft-timeout / attempts / easy mode / fps / dev panel
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const [softTimeoutIdx, setSoftTimeoutIdx] = useState<number | null>(null);
  const softTimeoutRef = useRef<number | null>(null);
  useEffect(() => { softTimeoutRef.current = softTimeoutIdx; }, [softTimeoutIdx]);

  const attemptsRef = useRef<number[]>([]); // attempts per challenge index
  const [easyMode, setEasyModeState] = useState(false);
  const [hintText, setHintText] = useState<string>("");
  const hintTextRef = useRef<string>("");
  useEffect(() => { hintTextRef.current = hintText; }, [hintText]);
  const sessionStartRef = useRef<number>(0);
  const challengeRunningMsRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  const [fps, setFps] = useState(0);
  const fpsAccumRef = useRef<{ frames: number; lastReport: number }>({ frames: 0, lastReport: 0 });

  // ── PAD / replay risk (SLICE 1) ──
  const padRef = useRef({
    brightnessHist: [] as number[],
    moire: 0,
    flicker: 0,
    planar: 0, // proxy via SpoofGuard flat-surface flag for now
    frame: 0,
  });
  // ── Pose / shoulder gate (SLICE 2) ──
  const poseRef = useRef<{
    frame: number;
    cadence: number;
    enabled: boolean;
    info: UpperBodyInfo | null;
    loading: boolean;
  }>({
    frame: 0,
    cadence: CONFIG.POSE_SAMPLE_EVERY_N,
    enabled: CONFIG.SHOULDER_GATE,
    info: null,
    loading: false,
  });

  const [devOpen, setDevOpen] = useState(false);
  const isDev = useMemo(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("dev"), []);

  // ── Session params from URL (host-provided nonce + flags) ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = readSessionFromUrl(window.location.search);
    sessionParamsRef.current = p;
    if (p.nonce) {
      digitsRef.current = digitsFromNonce(p.nonce, 4);
      setDigitsForVoice(digitsRef.current);
    }
  }, []);


  // Post-pass capture sequence: success → lookStraight → countdown → capturing
  type CaptureSeq = "idle" | "success" | "lookStraight" | "countdown" | "capturing";
  const [captureSeq, setCaptureSeq] = useState<CaptureSeq>("idle");
  const captureSeqRef = useRef<CaptureSeq>("idle");
  useEffect(() => { captureSeqRef.current = captureSeq; }, [captureSeq]);
  const [bigCountdown, setBigCountdown] = useState<number | null>(null);
  const lookStraightHoldRef = useRef<number | null>(null);
  const lastFramingOkRef = useRef(false);
  const captureIntervalRef = useRef<number | null>(null);

  // ── TTS: speak instructions on key state transitions ──
  // (additive; never blocks frame loop; fire-and-forget)
  useEffect(() => {
    if (step === "framing") sayKey("center");
    else if (step === "calibrating") sayKey("holdStillEllipsis");
    else if (step === "start" || step === "result" || step === "error" || step === "blocked") ttsCancel();
  }, [step, sayKey]);
  useEffect(() => {
    if (step !== "liveness") return;
    if (captureSeq === "success") sayKey("allDone");
    else if (captureSeq === "lookStraight") sayKey("lookStraight");
    else if (captureSeq === "capturing") sayKey("capturing");
  }, [captureSeq, step, sayKey]);
  useEffect(() => {
    if (bigCountdown == null) return;
    if (ttsMuted) return;
    // Speak the number in the active language (e.g. "৩"/"3").
    const localized = lang === "bn"
      ? String(bigCountdown).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)])
      : String(bigCountdown);
    try { ttsSpeak(localized, lang); } catch { /* ignore */ }
  }, [bigCountdown, lang, ttsMuted]);

  // Speak the active challenge prompt whenever the step/sub-step changes.
  // For randomSequence we speak each sub-step (not the crammed sentence).
  // Suppress TTS for the readDigits challenge when the mic is on, so the
  // app's own voice isn't captured into the audio track.
  const activeForTts = challengeView[activeIdx];
  const activeKindForTts = activeForTts?.kind;
  const activeSubKindForTts = activeForTts?.seqSubState?.kind;
  useEffect(() => {
    if (step !== "liveness") return;
    if (captureSeq !== "idle") return;
    if (!activeKindForTts) return;
    const voiceMicOn = sessionParamsRef.current.enableVoice === true;
    if (activeKindForTts === "readDigits" && voiceMicOn) {
      ttsCancel();
      return;
    }
    const speakKind = activeKindForTts === "randomSequence" ? activeSubKindForTts : activeKindForTts;
    if (!speakKind) return;
    const k = CHALLENGE_KEY[speakKind];
    if (k) sayKey(k);
  }, [step, captureSeq, activeKindForTts, activeSubKindForTts, sayKey]);


  const [liveReadout, setLiveReadout] = useState({
    blink: 0,
    smile: 0,
    yaw: 0,
    pitch: 0,
    yawChange: 0,
    pitchChange: 0,
    dominantAxis: "none",
    resolved: "none",
    pass: false,
  });
  const readoutAccumRef = useRef(0);

  // ── Integrity gate: early-locked reference + continuous similarity ──
  const refSigSamplesRef = useRef<FaceSignature[]>([]);
  const referenceSigRef = useRef<FaceSignature | null>(null);
  const lastSignatureRef = useRef<FaceSignature | null>(null);
  const identityLockedAtMsRef = useRef<number | null>(null);
  const simMinRef = useRef<number>(1);
  const lastFrontalSimRef = useRef<number>(1);
  const maxSigJumpRef = useRef<number>(0);
  const continuityBreaksRef = useRef<number>(0);
  const [refSigCaptured, setRefSigCaptured] = useState(false);
  const [liveSim, setLiveSim] = useState(1);
  const integrityFailStartRef = useRef<number | null>(null);
  const [integrityDecision, setIntegrityDecision] = useState<string>("ok");

  const currentTimeoutMs = easyMode ? CONFIG.EASY_CHALLENGE_TIMEOUT_MS : CONFIG.CHALLENGE_TIMEOUT_MS;
  const currentTimeoutRef = useRef<number>(CONFIG.CHALLENGE_TIMEOUT_MS);
  useEffect(() => { currentTimeoutRef.current = currentTimeoutMs; }, [currentTimeoutMs]);

  const hintKeyFor = (k: ChallengeKind, subKind?: ChallengeKind) => {
    const target = subKind ?? k;
    return target === "blink" ? "hintBlink"
      : target === "smile" ? "hintSmile"
      : target === "nod" || target === "lookUp" || target === "lookDown" ? "hintNod"
      : target === "mouthOpen" ? "mouthOpen"
      : "hintTurn";
  };

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const stopRecorder = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      try { r.stop(); } catch { /* ignore */ }
    }
    recorderRef.current = null;
  }, []);

  const stopAll = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (captureIntervalRef.current != null) {
      window.clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
    stopRecorder();
    chunksRef.current = [];
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, [stopRecorder]);


  useEffect(() => () => stopAll(), [stopAll]);
  useEffect(
    () => () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    },
    [photoUrl],
  );
  useEffect(
    () => () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    },
    [videoUrl],
  );

  const startRecorder = useCallback((stream: MediaStream) => {
    chunksRef.current = [];
    const mime = pickVideoMime();
    recorderMimeRef.current = mime;
    if (!mime) {
      setVideoSupported(false);
      recorderRef.current = null;
      return;
    }
    try {
      const rec = new MediaRecorder(stream, { mimeType: mime });
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          const ts = performance.now();
          chunksRef.current.push({ ts, blob: e.data });
          // Trim to last CONFIG.VIDEO_WINDOW_MS + 1s of cushion.
          const cutoff = ts - (CONFIG.VIDEO_WINDOW_MS + 1000);
          while (chunksRef.current.length > 1 && chunksRef.current[0].ts < cutoff) {
            chunksRef.current.shift();
          }
        }
      };
      rec.start(1000);
      recorderRef.current = rec;
      setVideoSupported(true);
    } catch {
      recorderRef.current = null;
      setVideoSupported(false);
    }
  }, []);

  const assembleVideo = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const rec = recorderRef.current;
      const mime = recorderMimeRef.current;
      if (!rec || !mime) {
        resolve(null);
        return;
      }
      const finalize = () => {
        const parts = chunksRef.current.map((c) => c.blob);
        if (parts.length === 0) {
          resolve(null);
          return;
        }
        // Use the recorder's actual mimeType if available; falls back to ours.
        const type = (rec.mimeType && rec.mimeType.length > 0) ? rec.mimeType : mime;
        const blob = new Blob(parts, { type });
        resolve(blob.size > 0 ? blob : null);
      };
      if (rec.state === "inactive") {
        finalize();
        return;
      }
      rec.onstop = () => finalize();
      // Flush any in-flight buffer so the final chunk is captured BEFORE stop.
      try { rec.requestData(); } catch { /* ignore */ }
      try { rec.stop(); } catch { finalize(); }
    });
  }, []);


  const fail = useCallback(
    (msg: string) => {
      stopAll();
      setErrorMsg(msg);
      setStep("error");
    },
    [stopAll],
  );

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    // Part B: re-verify SAME-PERSON match at the exact capture moment.
    // Compare the most recent live signature to the locked reference. A
    // mismatch here means a face swap happened during the countdown ⇒
    // abort capture entirely and restart from step 1.
    const ref = referenceSigRef.current;
    const cur = lastSignatureRef.current;
    if (ref && cur) {
      const sim = signatureSimilarity(ref, cur);
      setLiveSim(sim);
      if (sim < INTEGRITY.SIM_CAPTURE) {
        integrityRestartRef.current?.("mismatch");
        return;
      }
    } else if (ref && !cur) {
      // Reference exists but no face at the capture instant — treat as mismatch.
      integrityRestartRef.current?.("mismatch");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          fail(t("captureFail", langRef.current));
          return;
        }
        setImageBlob(blob);
        setPhotoUrl(URL.createObjectURL(blob));
        // Stop & assemble the rolling video — keep camera stream alive
        // so retake can re-run the post-pass countdown without redoing challenges.
        const vb = await assembleVideo();
        // Silent video: keep Blob in memory for upload; never create a
        // visible object URL or render <video> for it (Change 2).
        setVideoBlob(vb ?? null);
        setVideoUrl(null);
        setStep("result");
      },
      "image/jpeg",
      0.92,
    );
  }, [assembleVideo, fail]);
  const integrityRestartRef = useRef<((kind: "changed" | "mismatch") => void) | null>(null);


  const setSmoothGuidance = (text: string, now: number) => {
    if (text === guidanceDraftRef.current) return;
    guidanceDraftRef.current = text;
    if (now - lastGuidanceChangeRef.current > 300) {
      setGuidanceText(text);
      lastGuidanceChangeRef.current = now;
    } else {
      const target = text;
      window.setTimeout(() => {
        if (guidanceDraftRef.current === target) {
          setGuidanceText(target);
          lastGuidanceChangeRef.current = performance.now();
        }
      }, 320);
    }
  };

  const start = useCallback(async () => {
    setErrorMsg("");
    setStep("loading");
    try {
      // IMPORTANT: kick off getUserMedia FIRST, synchronously inside the user gesture.
      // Awaiting model downloads before requesting the camera loses the gesture context
      // on Safari/iOS and after re-entry post-publish, causing the camera to never appear.
      const wantAudio = sessionParamsRef.current.enableVoice === true;
      const streamPromise = navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: wantAudio,
      });

      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
      );
      const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numFaces: 2,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      landmarkerRef.current = landmarker;

      const stream = await streamPromise;
      streamRef.current = stream;
      cameraInspectionRef.current = inspectCamera(stream);
      startRecorder(stream);


      // Reset captured payload
      setImageBlob(null);
      setVideoBlob(null);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
      sessionMetaRef.current = {
        sessionId:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        startedAt: Date.now(),
      };


      challengesRef.current = [];
      setChallengeView([]);
      setActiveIdx(0);
      framingHoldStartRef.current = null;
      calibAccRef.current = emptyAccumulator();
      baselineRef.current = null;
      setCalibProgress(0);
      captureBufRef.current = [];
      spoofRef.current = new SpoofGuard();
      attemptsRef.current = [];
      setEasyModeState(false);
      setEasyMode(false);
      resetDirectionCalibration();
      resetPitchCalibration();
      setPaused(false);
      setSoftTimeoutIdx(null);
      setHintText("");
      setCaptureSeq("idle");
      captureSeqRef.current = "idle";
      setBigCountdown(null);
      lookStraightHoldRef.current = null;
      if (captureIntervalRef.current != null) {
        window.clearInterval(captureIntervalRef.current);
        captureIntervalRef.current = null;
      }
      refSigSamplesRef.current = [];
      referenceSigRef.current = null;
      lastSignatureRef.current = null;
      identityLockedAtMsRef.current = null;
      simMinRef.current = 1;
      lastFrontalSimRef.current = 1;
      maxSigJumpRef.current = 0;
      continuityBreaksRef.current = 0;
      setRefSigCaptured(false);
      setLiveSim(1);
      integrityFailStartRef.current = null;
      setIntegrityDecision("ok");
      challengeRunningMsRef.current = 0;
      sessionStartRef.current = performance.now();
      challengeTimelineRef.current = [];
      setStep("framing");

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      const L = langRef.current;
      if (/Permission|denied|NotAllowed/i.test(msg)) fail(t("permDenied", L));
      else if (/NotFound|no.*camera/i.test(msg)) fail(t("noCamera", L));
      else fail(msg);
    }
  }, [fail, startRecorder, videoUrl]);

  // Gate: nonce staleness + per-session attempt cap + consent before any camera access.
  const requestStart = useCallback(() => {
    const L = langRef.current;
    if (isNonceStale(sessionParamsRef.current)) { fail(t("sessionExpired", L)); return; }
    if (sessionAttemptsRef.current >= CONFIG.MAX_SESSION_ATTEMPTS) {
      setErrorMsg(t("tooManyAttempts", L));
      setStep("blocked");
      return;
    }
    if (!consentRef.current.given) { setStep("consent"); return; }
    sessionAttemptsRef.current += 1;
    void start();
  }, [fail, start]);

  const acceptConsent = useCallback(() => {
    consentRef.current = {
      given: true,
      timestamp: Date.now(),
      textVersion: CONFIG.CONSENT_TEXT_VERSION,
    };
    sessionAttemptsRef.current += 1;
    void start();
  }, [start]);

  const declineConsent = useCallback(() => {
    setStep("start");
  }, []);



  useEffect(() => {
    if (step !== "framing" && step !== "calibrating" && step !== "liveness") return;
    const v = videoRef.current;
    if (!v || !streamRef.current) return;
    if (v.srcObject !== streamRef.current) {
      v.srcObject = streamRef.current;
      v.play().catch(() => {});
    }
  }, [step]);

  const beginChallenges = useCallback(() => {
    const sp = sessionParamsRef.current;
    const chosen = sp.challengesFromHost && sp.challengesFromHost.length
      ? sp.challengesFromHost
      : (sp.nonce ? pickChallengesFromNonce(sp.nonce) : pickChallenges());
    const now = performance.now();
    const initial = chosen.map((k) =>
      k === "randomSequence" && sp.nonce
        ? newChallengeState(k, now, { seqActions: seqActionsFromNonce(sp.nonce) })
        : newChallengeState(k, now),
    );

    challengesRef.current = initial;
    attemptsRef.current = initial.map(() => 0);
    challengeTimelineRef.current = initial.map((c, i) => ({ idx: i, kind: c.kind, startedAt: Date.now(), completedAt: null }));
    setChallengeView(initial);
    setActiveIdx(0);

    challengeStartRef.current = now;
    challengePromptedAtRef.current = now;
    breatherUntilRef.current = 0;
    challengeRunningMsRef.current = 0;
    setTimeLeft(CONFIG.CHALLENGE_TIMEOUT_MS);
    setHintText("");
    setCaptureSeq("idle");
    captureSeqRef.current = "idle";
    setBigCountdown(null);
    lookStraightHoldRef.current = null;
    setStep("liveness");
  }, []);

  const tryAgainCurrent = useCallback(() => {
    // Policy: if any challenge fails/times out, restart ALL challenges from 0.
    const now = performance.now();
    challengesRef.current = challengesRef.current.map((c) =>
      c.kind === "randomSequence"
        ? newChallengeState(c.kind, now, { seqActions: c.seqActions })
        : newChallengeState(c.kind, now),
    );
    setChallengeView([...challengesRef.current]);
    attemptsRef.current = challengesRef.current.map(() => 0);
    setActiveIdx(0);
    challengeStartRef.current = now;
    challengePromptedAtRef.current = now;
    challengeRunningMsRef.current = 0;
    setTimeLeft(currentTimeoutRef.current);
    setBlinkMeter(0);
    setSmileMeter(0);
    setPoseMeter(0);
    setPaused(false);
    setSoftTimeoutIdx(null);
  }, []);

  const togglePause = useCallback(() => setPaused((p) => !p), []);

  // Part B: integrity failure — restart entire flow from step 1 (framing).
  // Keeps stream/landmarker alive (cheap), resets all challenge state, and
  // shows a bilingual hint explaining why.
  const integrityRestart = useCallback(
    (kind: "changed" | "mismatch") => {
      const L = langRef.current;
      setHintText(t(kind === "changed" ? "faceChanged" : "faceMismatch", L));
      setIntegrityDecision(kind === "changed" ? "FACE_CHANGED" : "FACE_MISMATCH");

      // Tear down post-pass sequence
      if (captureIntervalRef.current != null) {
        window.clearInterval(captureIntervalRef.current);
        captureIntervalRef.current = null;
      }
      setBigCountdown(null);
      captureSeqRef.current = "idle";
      setCaptureSeq("idle");
      lookStraightHoldRef.current = null;

      // Reset challenge state — passed list cleared (per spec).
      challengesRef.current = [];
      setChallengeView([]);
      setActiveIdx(0);
      attemptsRef.current = [];
      framingHoldStartRef.current = null;
      calibAccRef.current = emptyAccumulator();
      baselineRef.current = null;
      setCalibProgress(0);
      captureBufRef.current = [];
      spoofRef.current = new SpoofGuard();
      resetDirectionCalibration();
      resetPitchCalibration();

      // Reset integrity refs
      refSigSamplesRef.current = [];
      referenceSigRef.current = null;
      lastSignatureRef.current = null;
      identityLockedAtMsRef.current = null;
      simMinRef.current = 1;
      lastFrontalSimRef.current = 1;
      maxSigJumpRef.current = 0;
      continuityBreaksRef.current = 0;
      setRefSigCaptured(false);
      setLiveSim(1);
      integrityFailStartRef.current = null;

      setBlinkMeter(0);
      setSmileMeter(0);
      setPoseMeter(0);
      challengeRunningMsRef.current = 0;

      // Restart rolling video buffer
      if (streamRef.current) startRecorder(streamRef.current);

      setStep("framing");
    },
    [startRecorder],
  );
  useEffect(() => {
    integrityRestartRef.current = integrityRestart;
  }, [integrityRestart]);


  useEffect(() => {
    if (step !== "framing" && step !== "calibrating" && step !== "liveness") return;
    let lastTs = -1;
    let cancelled = false;
    // (post-pass capture sequence is managed by captureSeqRef now)

    const tick = () => {
      if (cancelled) return;
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      const overlay = overlayRef.current;
      const sample = sampleCanvasRef.current;
      if (!video || !landmarker || !overlay || !sample || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const ts = performance.now();
      if (ts === lastTs) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const dt = lastTs < 0 ? 0 : ts - lastTs;
      lastTs = ts;

      // FPS readout (1Hz)
      const fa = fpsAccumRef.current;
      fa.frames += 1;
      if (!fa.lastReport) fa.lastReport = ts;
      if (ts - fa.lastReport > 1000) {
        setFps(Math.round((fa.frames * 1000) / (ts - fa.lastReport)));
        fa.frames = 0;
        fa.lastReport = ts;
      }

      let result: FaceLandmarkerResult;
      try {
        result = landmarker.detectForVideo(video, ts);
      } catch {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const faces = result.faceLandmarks?.length ?? 0;
      const m =
        faces >= 1
          ? computeMetrics(
              result.faceLandmarks[0],
              result.faceBlendshapes,
              result.facialTransformationMatrixes?.[0],
            )
          : null;

      const sctx = sample.getContext("2d");
      let brightness = 128;
      if (sctx) {
        sample.width = 64;
        sample.height = Math.max(
          1,
          Math.round((64 * video.videoHeight) / Math.max(1, video.videoWidth)),
        );
        sctx.drawImage(video, 0, 0, sample.width, sample.height);
        brightness = avgBrightness(sctx, sample.width, sample.height);

        // ── SLICE 1: PAD scorers (advisory, throttled) ──
        const pad = padRef.current;
        pad.frame++;
        // brightness history for flicker autocorr
        pad.brightnessHist.push(brightness);
        if (pad.brightnessHist.length > 30) pad.brightnessHist.shift();
        // moiré every 4th frame
        if (pad.frame % 4 === 0) {
          try {
            const imgd = sctx.getImageData(0, 0, sample.width, sample.height);
            // grayscale
            const gray = new Uint8ClampedArray(sample.width * sample.height);
            for (let i = 0, j = 0; i < imgd.data.length; i += 4, j++) {
              gray[j] = (imgd.data[i] + imgd.data[i + 1] + imgd.data[i + 2]) / 3;
            }
            pad.moire = moireEnergy(gray, sample.width, sample.height);
          } catch { /* ignore */ }
          pad.flicker = flickerScore(pad.brightnessHist);
        }
      }

      // ── SLICE 2: shoulder/upper-body check (opt-in, low cadence) ──
      const pose = poseRef.current;
      if (pose.enabled && m) {
        pose.frame++;
        // FPS guard: degrade cadence if FPS is suffering
        if (fps > 0 && fps < 18 && pose.cadence < 8) pose.cadence = pose.cadence * 2;
        if (pose.frame % pose.cadence === 0 && !pose.loading) {
          pose.loading = true;
          getPoseDetector()
            .then((det) => {
              try {
                const res = det.detectForVideo(video, ts);
                pose.info = analyseShoulders(
                  res,
                  Math.max(0.05, m.faceSize),
                  CONFIG.SHOULDER_SPAN_RATIO_MIN,
                  CONFIG.SHOULDER_MOTION_MIN_STDDEV,
                );
              } catch { /* ignore */ }
            })
            .catch(() => { /* model load failed → silently disable */ pose.enabled = false; })
            .finally(() => { pose.loading = false; });
        }
      }

      drawOverlay(overlay, m, faces);

      const g = frameGuidance(faces, m, brightness);
      setCentered(g.ok);
      lastFramingOkRef.current = g.ok;
      setSmoothGuidance(t(GUIDANCE_KEY[g.key], langRef.current), ts);

      // Throttled dev readout (5Hz)
      readoutAccumRef.current += dt;
      if (m && readoutAccumRef.current > 200) {
        readoutAccumRef.current = 0;
        const activeForReadout = challengesRef.current.find((c) => !c.done)?.kind;
        const requestedHead =
          activeForReadout === "turnLeft" || activeForReadout === "turnRight" || activeForReadout === "nod"
            ? activeForReadout
            : undefined;
        const head = baselineRef.current
          ? inspectHeadGesture(m, baselineRef.current, requestedHead)
          : null;
        setLiveReadout({
          blink: m.blinkMax,
          smile: m.smileMax,
          yaw: m.yaw,
          pitch: m.pitch,
          yawChange: head?.yawChange ?? 0,
          pitchChange: head?.pitchChange ?? 0,
          dominantAxis: head?.dominantAxis ?? "none",
          resolved: head?.resolved ?? "none",
          pass: head?.pass ?? false,
        });
      }

      captureBufRef.current.push({ ts, brightness, centered: g.ok });
      if (captureBufRef.current.length > CONFIG.CAPTURE_BUFFER) captureBufRef.current.shift();

      const currentStep = stepRef.current;

      // Part A: multi-face mid-flow does NOT hard fail. frameGuidance()
      // already returns ok=false + key="onePerson", which pauses challenge
      // detection/timer and shows the bilingual hint. The user can recover
      // by getting alone again — no reset, no error screen.

      // ── Identity gate: lock early, compare every frame to shutter ──
      // Replaces the old post-pass-only finalize/compare so face-swap during
      // or between challenges is caught, not just during the countdown.
      if (m && result.faceLandmarks?.[0]) {
        const sig = computeSignature(result.faceLandmarks[0]);
        const prev = lastSignatureRef.current;
        lastSignatureRef.current = sig;

        if (stepRef.current === "liveness" && baselineRef.current) {
          const isFrontal = Math.abs(m.yaw) < 0.22 && Math.abs(m.pitch) < 0.22;

          // (1) Build & lock the reference from the first clean frontal window.
          if (referenceSigRef.current == null && isFrontal && faces === 1) {
            refSigSamplesRef.current.push(sig);
            if (refSigSamplesRef.current.length >= INTEGRITY.LOCK_MIN_SAMPLES) {
              const locked = avgSignatures(refSigSamplesRef.current);
              if (locked) {
                referenceSigRef.current = locked;
                identityLockedAtMsRef.current = Date.now();
                setRefSigCaptured(true);
              }
            }
          }

          // (3) Continuity jump guard — catches smooth swaps without face-loss.
          if (prev && referenceSigRef.current) {
            const jump = 1 - signatureSimilarity(prev, sig);
            if (jump > maxSigJumpRef.current) maxSigJumpRef.current = jump;
            if (jump > INTEGRITY.MAX_SIG_JUMP) {
              continuityBreaksRef.current += 1;
              integrityRestart("changed");
              return;
            }
          }

          // (2) Continuous compare vs locked reference. Frontal-only so big
          // expressions / head-turn challenges don't falsely trip the gate.
          const ref = referenceSigRef.current;
          if (ref) {
            if (isFrontal) {
              const sim = signatureSimilarity(ref, sig);
              lastFrontalSimRef.current = sim;
              if (sim < simMinRef.current) simMinRef.current = sim;
              setLiveSim(sim);
              if (sim < INTEGRITY.SIM_PASS) {
                if (integrityFailStartRef.current == null) integrityFailStartRef.current = ts;
                if (ts - integrityFailStartRef.current >= INTEGRITY.FAIL_SUSTAIN_MS) {
                  integrityRestart("changed");
                  return;
                }
              } else {
                integrityFailStartRef.current = null;
              }
            } else {
              // Non-frontal: hold last good sim; don't accumulate failures.
              integrityFailStartRef.current = null;
            }
          }
        }
      } else {
        lastSignatureRef.current = null;
        integrityFailStartRef.current = null;
      }

      if (currentStep === "framing") {
        // SLICE 2: block framing pass if shoulders required but not visible.
        const pInfo = poseRef.current.info;
        const shoulderBlock =
          poseRef.current.enabled &&
          pInfo != null &&
          !pInfo.shouldersVisible;
        if (shoulderBlock) {
          setSmoothGuidance(t("shouldersHint", langRef.current), ts);
          framingHoldStartRef.current = null;
        } else if (g.ok && m) {
          if (framingHoldStartRef.current == null) framingHoldStartRef.current = ts;
          if (ts - framingHoldStartRef.current >= CONFIG.FRAMING_HOLD_MS) {
            calibAccRef.current = emptyAccumulator();
            calibStartRef.current = ts;
            setStep("calibrating");
          }
        } else {
          framingHoldStartRef.current = null;
        }
      } else if (currentStep === "calibrating") {
        if (!g.ok || !m) {
          calibAccRef.current = emptyAccumulator();
          calibStartRef.current = ts;
          setCalibProgress(0);
          setStep("framing");
        } else {
          accumulate(calibAccRef.current, m);
          const elapsed = ts - calibStartRef.current;
          setCalibProgress(Math.min(1, elapsed / CONFIG.CALIBRATION_MS));
          if (elapsed >= CONFIG.CALIBRATION_MS) {
            baselineRef.current = finalizeBaseline(calibAccRef.current);
            beginChallenges();
          }
        }
      } else if (currentStep === "liveness") {
        const baseline = baselineRef.current;
        const isPaused = pausedRef.current;
        const inSoftTimeout = softTimeoutRef.current != null;

        if (m && baseline && !isPaused && !inSoftTimeout) {
          spoofRef.current.push(m.fingerprint, brightness);
          const spoof = spoofRef.current.check(m, baseline);
          if (spoof) {
            const L = langRef.current;
            fail(spoof === "Flat surface detected" ? t("flatSurface", L) : t("noMotion", L));
            return;
          }
        }

        if (m && baseline) {
          setBlinkMeter(Math.max(0, Math.min(1, m.blinkAvg)));
          setSmileMeter(
            Math.max(0, Math.min(1, (m.smileAvg - baseline.smileNeutral) / 0.3)),
          );
        }

        const idx = challengesRef.current.findIndex((c) => !c.done);
        const activeKind = idx !== -1 ? challengesRef.current[idx].kind : null;
        // For turn/nod the user MUST move their head — don't require a
        // perfectly straight framing pose, only that a face is present and
        // reasonably centered. Otherwise the challenge can never register.
        const poseChallenge =
          activeKind === "turnLeft" || activeKind === "turnRight" || activeKind === "nod";
        const framingOk = poseChallenge
          ? !!m && faces === 1 && m.centerOffset < TH.CENTER_MAX * 1.6
          : g.ok;

        // Detection + timer only run when actively engaged.
        const canRun =
          !isPaused &&
          !inSoftTimeout &&
          framingOk &&
          m &&
          baseline &&
          ts >= breatherUntilRef.current;


        if (idx === -1) {
          // ALL CHALLENGES PASSED — explicit capture sequence:
          // success (brief celebration) → lookStraight (hold) → 3-2-1 → capture
          const seq = captureSeqRef.current;

          // (identity reference is now locked & compared continuously in the
          // signature block above — no post-pass-only logic needed here.)



          if (seq === "idle") {
            captureSeqRef.current = "success";
            setCaptureSeq("success");
            window.setTimeout(() => {
              if (stepRef.current !== "liveness") return;
              if (captureSeqRef.current !== "success") return;
              captureSeqRef.current = "lookStraight";
              setCaptureSeq("lookStraight");
              lookStraightHoldRef.current = null;
            }, CONFIG.SUCCESS_HOLD_MS);
          } else if (seq === "lookStraight") {
            const frontal =
              !!m && g.ok &&
              Math.abs(m.yaw) < CONFIG.LOOK_STRAIGHT_YAW_MAX &&
              Math.abs(m.pitch) < CONFIG.LOOK_STRAIGHT_PITCH_MAX;
            if (frontal) {
              if (lookStraightHoldRef.current == null) lookStraightHoldRef.current = ts;
              if (ts - lookStraightHoldRef.current >= CONFIG.LOOK_STRAIGHT_HOLD_MS) {
                captureSeqRef.current = "countdown";
                setCaptureSeq("countdown");
                let n = CONFIG.COUNTDOWN_START;
                setBigCountdown(n);
                const iv = window.setInterval(() => {
                  if (captureSeqRef.current !== "countdown") {
                    window.clearInterval(iv);
                    captureIntervalRef.current = null;
                    return;
                  }
                  if (!lastFramingOkRef.current) {
                    window.clearInterval(iv);
                    captureIntervalRef.current = null;
                    setBigCountdown(null);
                    captureSeqRef.current = "lookStraight";
                    setCaptureSeq("lookStraight");
                    lookStraightHoldRef.current = null;
                    return;
                  }
                  n -= 1;
                  if (n <= 0) {
                    window.clearInterval(iv);
                    captureIntervalRef.current = null;
                    setBigCountdown(null);
                    captureSeqRef.current = "capturing";
                    setCaptureSeq("capturing");
                    setFlash(true);
                    setTimeout(() => setFlash(false), CONFIG.FLASH_MS);
                    if (stepRef.current === "liveness") capture();
                  } else {
                    setBigCountdown(n);
                  }
                }, CONFIG.COUNTDOWN_INTERVAL_MS);
                captureIntervalRef.current = iv;

              }
            } else {
              lookStraightHoldRef.current = null;
            }
          }
        } else if (canRun && m && baseline) {
          // (reference signature is now built/locked by the identity block
          // above; no per-challenge sampling needed here.)

          const sinceShown = ts - challengePromptedAtRef.current;
          if (sinceShown >= CONFIG.PROMPT_READ_DELAY_MS) {
            // Accumulate active running time (only while engaged).
            challengeRunningMsRef.current += dt;
            const remaining = Math.max(0, currentTimeoutRef.current - challengeRunningMsRef.current);
            setTimeLeft(remaining);

            if (sinceShown >= CONFIG.PROMPT_REACTION_MIN_MS) {
              const prev = challengesRef.current[idx];
              const updated = updateChallenge(prev, m, baseline, ts);
              const wasDone = prev.done;
              challengesRef.current[idx] = updated;
              setPoseMeter(updated.poseProgress ?? 0);

              if (
                updated.kind === "blink" &&
                updated.blinkJustCountedAt &&
                updated.blinkJustCountedAt !== prev.blinkJustCountedAt
              ) {
                setBlinkTick((x) => x + 1);
              }

              if (updated.done && !wasDone) {
                if (
                  (updated.kind === "turnLeft" || updated.kind === "turnRight") &&
                  updated.parallaxOk === false
                ) {
                  fail(t("flatSurface", langRef.current));
                  return;
                }
                const tl = challengeTimelineRef.current[idx];
                if (tl && tl.completedAt == null) tl.completedAt = Date.now();
                setChallengeView([...challengesRef.current]);

                const nextIdx = Math.min(idx + 1, challengesRef.current.length - 1);
                breatherUntilRef.current = ts + CONFIG.CHALLENGE_BREATHER_MS;
                window.setTimeout(() => {
                  if (stepRef.current !== "liveness") return;
                  setActiveIdx(nextIdx);
                  challengeStartRef.current = performance.now();
                  challengePromptedAtRef.current = performance.now();
                  challengeRunningMsRef.current = 0;
                  setTimeLeft(currentTimeoutRef.current);
                  setBlinkMeter(0);
                  setSmileMeter(0);
                  setPoseMeter(0);
                  setHintText("");
                }, CONFIG.CHALLENGE_BREATHER_MS);
              } else {
                // Surface strict signed-axis feedback for head challenges.
                if (updated.wrongHint) {
                  setHintText(t(updated.wrongHint, langRef.current));
                } else if (
                  !updated.wrongWay &&
                  (hintTextRef.current === t("turnOtherWay", langRef.current) ||
                    hintTextRef.current === t("wrongDir", langRef.current) ||
                    hintTextRef.current === t("nodNotSide", langRef.current))
                ) {
                  setHintText("");
                }
                setChallengeView([...challengesRef.current]);
              }
            }

            // Soft timeout — DO NOT hard fail.
            if (remaining === 0) {
              const a = (attemptsRef.current[idx] ?? 0) + 1;
              attemptsRef.current[idx] = a;
              const cur = challengesRef.current[idx];
              const L = langRef.current;

              // Auto-hint after first timeout on this challenge.
              setHintText(t(hintKeyFor(cur.kind, cur.seqSubState?.kind) as Parameters<typeof t>[0], L));

              // Enable easy mode immediately after the first miss.
              if (a >= 1 && !EASY.on) {
                setEasyMode(true);
                setEasyModeState(true);
              }


              // Part A: NEVER auto-reset or auto-fail on timeouts. Always
              // re-arm the CURRENT challenge via soft retry. Earlier passes
              // stay locked in challengesRef.current. The user can tap
              // Cancel for an explicit full restart.
              setSoftTimeoutIdx(idx);

            }
          }
        }
      }


      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const retake = useCallback(() => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    setImageBlob(null);
    setVideoBlob(null);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    setSubmitState("idle");
    setSubmitError("");

    // Always re-run the FULL flow (all challenges, then capture).
    // Do not shortcut into the post-pass countdown.
    void start();

  }, [photoUrl, start, startRecorder, videoUrl]);

  const reset = useCallback(() => {
    stopAll();
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    setImageBlob(null);
    setVideoBlob(null);
    setSubmitState("idle");
    setSubmitError("");
    setStep("start");
    setErrorMsg("");
  }, [photoUrl, stopAll, videoUrl]);

  const buildMeta = useCallback(
    (extras?: { imageHash?: string | null; videoHash?: string | null }) => {
      const session = sessionMetaRef.current;
      const sp = sessionParamsRef.current;
      const cam = cameraInspectionRef.current;
      const consent = consentRef.current;
      return {
        // ── identity / session binding ──
        sessionId: session?.sessionId ?? null,
        sessionNonce: sp.nonce,
        nonceIssuedAt: sp.nonceIssuedAt,
        nonceExpiresAt: sp.expiresAt,
        timestamp: new Date().toISOString(),
        startedAt: session?.startedAt ?? null,

        // ── consent ──
        consent: {
          given: consent.given,
          timestamp: consent.timestamp,
          textVersion: consent.textVersion,
        },

        // ── challenges (issued order + timestamps) ──
        challengeOrder: challengesRef.current.map((c) => c.kind),
        challengesIssued: challengesRef.current.map((c, i) => ({ order: i, kind: c.kind })),
        perChallengeTimestamps: challengeTimelineRef.current,
        perChallengeResult: challengesRef.current.map((c) => ({
          kind: c.kind,
          done: c.done,
          blinkCount: c.blinkCount ?? 0,
          smileIntensity: c.smileIntensity ?? 0,
          poseProgress: c.poseProgress ?? 0,
          parallaxOk: c.parallaxOk ?? null,
        })),
        randomSequence: (() => {
          const c = challengesRef.current.find((x) => x.kind === "randomSequence");
          if (!c || !c.seqActions) return null;
          return {
            steps: c.seqActions,
            completedInOrder: c.done === true,
            reachedStep: (c.seqStep ?? 0) + (c.done ? 1 : 0),
          };
        })(),
        blinkCount: challengesRef.current
          .filter((c) => c.kind === "blink")
          .reduce((s, c) => s + (c.blinkCount ?? 0), 0),
        livenessScore: challengesRef.current.length
          ? challengesRef.current.filter((c) => c.done).length / challengesRef.current.length
          : 0,

        // ── voice (advisory; server runs ASR) ──
        voice: sp.enableVoice
          ? { enabled: true, expectedDigits: digitsRef.current, asrRequired: true }
          : { enabled: false },

        // ── tamper-evidence ──
        imageHash: extras?.imageHash ?? null,
        videoHash: extras?.videoHash ?? null,

        // ── device / camera (heuristic; advisory) ──
        device: collectDeviceInfo(),
        camera: cam
          ? {
              label: cam.label,
              virtualCameraSuspected: cam.virtualCameraSuspected,
              settings: cam.settings,
              capabilities: cam.capabilities,
            }
          : null,

        // ── fraud / attempts ──
        attemptCount: sessionAttemptsRef.current,

        // ── UI / capture state ──
        language: langRef.current,
        easyModeUsed: easyMode,
        videoSupported,
        videoMime: recorderMimeRef.current ?? null,
        integrityDecision,
        identity: {
          lockedAtMs: identityLockedAtMsRef.current,
          simMin: simMinRef.current,
          simAtCapture: lastFrontalSimRef.current,
          maxSigJump: maxSigJumpRef.current,
          continuityBreaks: continuityBreaksRef.current,
        },
        ...(() => {
          // ── SLICE 1+2: PAD risk + upper-body presence (advisory) ──
          const pad = padRef.current;
          const cam = cameraInspectionRef.current;
          const upper = poseRef.current.info;
          const flags: Partial<Record<SpoofFlag, number>> = {
            "screen-artifact": pad.moire > CONFIG.MOIRE_ENERGY_MAX ? pad.moire : 0,
            "screen-flicker": pad.flicker > CONFIG.FLICKER_SCORE_MAX ? pad.flicker : 0,
            "planar-motion": pad.planar > CONFIG.PLANAR_MOTION_MAX ? pad.planar : 0,
            "virtualCameraSuspected": cam?.virtualCameraSuspected ? 1 : 0,
          };
          const replayRisk = replayRiskScore(flags, CONFIG.REPLAY_RISK_WEIGHTS);
          const active = activeFlags(flags, 0.5);
          return {
            spoofFlags: active,
            replayRisk,
            needsManualReview: replayRisk > CONFIG.REPLAY_RISK_THRESHOLD,
            padSignals: { moire: pad.moire, flicker: pad.flicker, planar: pad.planar },
            upperBody: upper ?? { shouldersVisible: null, shoulderSpanRatio: 0, shoulderMotionOk: null },
            depth: { method: "monocular-proxy", compliant: false },
          };
        })(),

        // ── advisory disclaimer for server consumers ──
        clientNotice:
          "All client-side liveness/quality signals are advisory. The server must independently re-verify the media and nonce.",
      };
    },
    [easyMode, videoSupported, integrityDecision],
  );

  const submit = useCallback(async () => {
    if (!imageBlob) return;
    setSubmitState("uploading");
    setSubmitError("");
    const [imageHash, videoHash] = await Promise.all([
      sha256Blob(imageBlob),
      videoBlob ? sha256Blob(videoBlob) : Promise.resolve(null),
    ]);
    const fd = new FormData();
    fd.append("image", imageBlob, "selfie.jpg");
    if (videoBlob) fd.append("video", videoBlob, "liveness.webm");
    fd.append("meta", JSON.stringify(buildMeta({ imageHash, videoHash })));

    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), CONFIG.SUBMIT_TIMEOUT_MS);
    try {
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : undefined,
        body: fd,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSubmitState("ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      setSubmitError(msg);
      setSubmitState("fail");
    } finally {
      window.clearTimeout(timer);
    }
  }, [buildMeta, imageBlob, videoBlob]);




  return (
    <main
      className="min-h-dvh bg-zinc-950 text-zinc-100"

      style={{
        fontFamily:
          lang === "bn"
            ? "'Noto Sans Bengali', 'Inter', system-ui, sans-serif"
            : "'Inter', system-ui, sans-serif",
      }}
    >
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-6">
        <header className="flex items-center justify-between gap-2 pb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" aria-hidden="true" />
            <h1 className="text-lg font-semibold tracking-tight">{tx("appName")}</h1>
          </div>
          <LangToggle lang={lang} onChange={setLang} />
        </header>

        {step === "start" && (
          <StartScreen
            onStart={requestStart}
            tx={tx}
            voiceEnabled={sessionParamsRef.current.enableVoice}
            nonceBound={!!sessionParamsRef.current.nonce}
          />
        )}
        {step === "consent" && (
          <ConsentScreen
            tx={tx}
            voiceEnabled={sessionParamsRef.current.enableVoice}
            onAccept={acceptConsent}
            onDecline={declineConsent}
          />
        )}
        {step === "blocked" && (
          <ErrorScreen msg={errorMsg || tx("tooManyAttempts")} onRetry={reset} onHome={reset} tx={tx} />
        )}
        {step === "loading" && <LoadingScreen tx={tx} />}

        {sessionParamsRef.current.enableVoice && digitsForVoice && (step === "framing" || step === "calibrating" || step === "liveness") && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-sm text-amber-200">
            🎤 {tx("sayDigits", { digits: digitsForVoice })}
          </div>
        )}
        {(step === "framing" || step === "calibrating" || step === "liveness") && (

          <LivenessScreen
            phase={step}
            videoRef={videoRef}
            overlayRef={overlayRef}
            sampleRef={sampleCanvasRef}
            challenges={challengeView}
            activeIdx={activeIdx}
            guidance={guidanceText}
            centered={centered}
            countdown={bigCountdown}
            captureSeq={captureSeq}
            liveReadout={liveReadout}
            timeLeft={timeLeft}
            timeoutMs={currentTimeoutMs}
            flash={flash}
            blinkTick={blinkTick}
            calibProgress={calibProgress}
            blinkMeter={blinkMeter}
            smileMeter={smileMeter}
            poseMeter={poseMeter}
            paused={paused}
            onTogglePause={togglePause}
            softTimeoutIdx={softTimeoutIdx}
            onTryAgain={tryAgainCurrent}
            attempts={softTimeoutIdx != null ? attemptsRef.current[softTimeoutIdx] ?? 0 : 0}
            hintText={hintText}
            easyMode={easyMode}
            fps={fps}
            integrity={{
              currentIdx: activeIdx,
              passed: challengeView.filter((c) => c.done).length,
              refCaptured: refSigCaptured,
              liveSim,
              decision: integrityDecision,
            }}
            isDev={isDev}
            devOpen={devOpen}
            onToggleDev={() => setDevOpen((v) => !v)}
            onCancel={reset}
            padReadout={{
              moire: padRef.current.moire,
              flicker: padRef.current.flicker,
              planar: padRef.current.planar,
              shoulderSpanRatio: poseRef.current.info?.shoulderSpanRatio ?? 0,
              shouldersVisible: poseRef.current.info?.shouldersVisible ?? null,
            }}
            tx={tx}
            lang={lang}
          />
        )}

        {step === "result" && photoUrl && (
          <ResultScreen
            photoUrl={photoUrl}
            videoUrl={videoUrl}
            videoSupported={videoSupported}
            imageBlob={imageBlob}
            videoBlob={videoBlob}
            submitState={submitState}
            submitError={submitError}
            onRetake={retake}
            onSubmit={submit}
            onHome={reset}
            tx={tx}
          />
        )}
        {step === "error" && <ErrorScreen msg={errorMsg} onRetry={start} onHome={reset} tx={tx} />}

        <footer className="mt-auto pt-6 text-center text-[11px] leading-relaxed text-zinc-500">
          {tx("disclaimer")}
        </footer>
      </div>
    </main>
  );
}

type Tx = (k: Parameters<typeof t>[0], vars?: Record<string, string | number>) => string;

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div
      role="group"
      aria-label="Language"
      className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/60 p-0.5 text-xs"
    >
      <Languages className="ml-1.5 h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
      <button
        onClick={() => onChange("bn")}
        className={`rounded-full px-2.5 py-1 transition-colors ${
          lang === "bn" ? "bg-emerald-500 text-zinc-950" : "text-zinc-300 hover:text-white"
        }`}
        style={{ fontFamily: "'Noto Sans Bengali', sans-serif" }}
      >
        বাংলা
      </button>
      <button
        onClick={() => onChange("en")}
        className={`rounded-full px-2.5 py-1 transition-colors ${
          lang === "en" ? "bg-emerald-500 text-zinc-950" : "text-zinc-300 hover:text-white"
        }`}
      >
        EN
      </button>
    </div>
  );
}

function StartScreen({
  onStart,
  tx,
  voiceEnabled = false,
  nonceBound = false,
}: {
  onStart: () => void;
  tx: Tx;
  voiceEnabled?: boolean;
  nonceBound?: boolean;
}) {
  return (
    <section className="space-y-6 pt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{tx("startTitle")}</h2>
        <p className="mt-2 text-sm text-zinc-400">{tx("startSubtitle")}</p>
        {(voiceEnabled || nonceBound) && (
          <p className="mt-2 text-[11px] text-zinc-500">
            {nonceBound ? "✓ session-bound" : ""}{nonceBound && voiceEnabled ? " · " : ""}{voiceEnabled ? "🎤 voice on" : ""}
          </p>
        )}
      </div>
      <ol className="space-y-3 text-sm">
        {(["step1", "step2", "step3", "step4"] as const).map((k, i) => (
          <li key={k} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-semibold text-emerald-400">
              {i + 1}
            </span>
            <span className="text-zinc-300">{tx(k)}</span>
          </li>
        ))}
      </ol>
      <Button
        size="lg"
        onClick={onStart}
        className="w-full bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
      >
        <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
        {tx("startBtn")}
      </Button>
    </section>
  );
}

function ConsentScreen({
  tx,
  voiceEnabled,
  onAccept,
  onDecline,
}: {
  tx: Tx;
  voiceEnabled: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <section className="space-y-5 pt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{tx("consentTitle")}</h2>
        <p className="mt-2 text-sm text-zinc-300">{tx("consentBody")}</p>
        {voiceEnabled && (
          <p className="mt-2 text-sm text-amber-300">{tx("consentBodyVoice")}</p>
        )}
      </div>
      <label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-200">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-1 h-4 w-4 accent-emerald-500"
        />
        <span>{tx("consentCheckbox")}</span>
      </label>
      <div className="flex gap-2">
        <Button
          size="lg"
          onClick={onAccept}
          disabled={!checked}
          className="flex-1 bg-emerald-500 text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {tx("consentContinue")}
        </Button>
        <Button size="lg" variant="ghost" onClick={onDecline} className="text-zinc-300">
          {tx("consentDecline")}
        </Button>
      </div>
    </section>
  );
}


function LoadingScreen({ tx }: { tx: Tx }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-400">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
      <p className="text-sm">{tx("loading")}</p>
    </div>
  );
}

function LivenessScreen({
  phase,
  videoRef,
  overlayRef,
  sampleRef,
  challenges,
  activeIdx,
  guidance,
  centered,
  countdown,
  captureSeq,
  liveReadout,
  timeLeft,
  timeoutMs,
  flash,
  blinkTick,
  calibProgress,
  blinkMeter,
  smileMeter,
  poseMeter,
  paused,
  onTogglePause,
  softTimeoutIdx,
  onTryAgain,
  attempts,
  hintText,
  easyMode,
  fps,
  integrity,
  isDev,
  devOpen,
  onToggleDev,
  onCancel,
  
  padReadout,
  tx,
  lang,
}: {
  phase: "framing" | "calibrating" | "liveness";
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  sampleRef: React.RefObject<HTMLCanvasElement | null>;
  challenges: ChallengeState[];
  activeIdx: number;
  guidance: string;
  centered: boolean;
  countdown: number | null;
  captureSeq: "idle" | "success" | "lookStraight" | "countdown" | "capturing";
  liveReadout: {
    blink: number;
    smile: number;
    yaw: number;
    pitch: number;
    yawChange: number;
    pitchChange: number;
    dominantAxis: string;
    resolved: string;
    pass: boolean;
  };
  timeLeft: number;
  timeoutMs: number;
  flash: boolean;
  blinkTick: number;
  calibProgress: number;
  blinkMeter: number;
  smileMeter: number;
  poseMeter: number;
  paused: boolean;
  onTogglePause: () => void;
  softTimeoutIdx: number | null;
  onTryAgain: () => void;
  attempts: number;
  hintText: string;
  easyMode: boolean;
  fps: number;
  integrity: { currentIdx: number; passed: number; refCaptured: boolean; liveSim: number; decision: string };
  isDev: boolean;
  devOpen: boolean;
  onToggleDev: () => void;
  onCancel: () => void;
  
  padReadout?: {
    moire: number;
    flicker: number;
    planar: number;
    shoulderSpanRatio: number;
    shouldersVisible: boolean | null;
  };
  tx: Tx;
  lang: Lang;
}) {
  const active = challenges[activeIdx];
  const totalSteps = challenges.length || 3;
  const stepNum = phase === "liveness" ? Math.min(activeIdx + 1, totalSteps) : 0;
  const timePct = Math.max(0, Math.min(100, (timeLeft / Math.max(1, timeoutMs)) * 100));
  const secondsLeft = Math.ceil(timeLeft / 1000);
  const amber = phase === "liveness" && timeLeft > 0 && timeLeft <= 5000;
  const inSoft = softTimeoutIdx != null;
  const inCapture = phase === "liveness" && captureSeq !== "idle";

  // randomSequence: render the CURRENT sub-step as if it were its own challenge
  // (full friendly prompt + demo + meter), with a small "{n}/2" progress chip.
  const isSeq = !!active && active.kind === "randomSequence";
  const seqStep = isSeq ? (active!.seqStep ?? 0) : 0;
  const seqActions = isSeq ? active!.seqActions : undefined;
  const displayActive = isSeq ? (active!.seqSubState ?? active!) : active;
  const displayKind = displayActive?.kind ?? active?.kind;

  let headerLabel = "";
  if (phase === "framing") headerLabel = tx("framing");
  else if (phase === "calibrating") headerLabel = tx("calibrating");
  else if (inCapture) headerLabel = tx("allDone");
  else headerLabel = tx("stepOf", { n: stepNum, t: totalSteps });

  let instruction = "";
  if (phase === "framing") instruction = tx("getInFrame");
  else if (phase === "calibrating") instruction = tx("holdStillEllipsis");
  else if (captureSeq === "success") instruction = tx("allDone");
  else if (captureSeq === "lookStraight") instruction = tx("lookStraight");
  else if (captureSeq === "countdown") instruction = tx("hold");
  else if (captureSeq === "capturing") instruction = tx("capturing");
  else if (active && displayKind) instruction = tx(CHALLENGE_KEY[displayKind]);
  else instruction = tx("allSet");

  let meterLine: string | null = null;
  let meterValue = 0;
  if (phase === "liveness" && !inCapture && displayActive) {
    if (displayKind === "blink") {
      meterLine = tx("blinkProgress", { n: displayActive.blinkCount ?? 0 });
      meterValue = blinkMeter;
    } else if (displayKind === "smile") {
      meterLine = (displayActive.smileHoldStart ?? 0) > 0 ? tx("smileHold") : tx("showSmile");
      meterValue = Math.max(smileMeter, displayActive.smileIntensity ?? 0);
    } else {
      meterLine = tx("slowSteady");
      meterValue = Math.max(poseMeter, displayActive.poseProgress ?? 0);
    }
    if (isSeq && seqActions) {
      const progress = tx("seqProgress", { n: seqStep + 1, t: 2 });
      const nextHint = seqStep === 0 ? ` · ${actionShort(seqActions[1], lang)} →` : "";
      meterLine = `${progress}  ·  ${meterLine ?? ""}${nextHint}`;
    }
  }

  // Demo icon — only during running challenges; success/capture show a check.
  const showDemo = phase === "liveness" && !inCapture && !!active;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span className="flex items-center gap-2">
          {headerLabel}
          {easyMode && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-amber-400/30">
              {tx("easyModeOn")}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {phase === "liveness" && !inCapture && (
            <button
              onClick={onTogglePause}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-zinc-900"
              aria-label={paused ? tx("resumeBtn") : tx("pauseBtn")}
            >
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              <span>{paused ? tx("resumeBtn") : tx("pauseBtn")}</span>
            </button>
          )}
          {isDev && (
            <button
              onClick={onToggleDev}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-zinc-900"
              aria-label="Dev"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-zinc-900"
            aria-label={tx("cancel")}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" /> {tx("cancel")}
          </button>
        </div>
      </div>

      {/* TWO-ZONE LAYOUT: message band on top (mobile) / left (desktop),
          camera card below (mobile) / right (desktop). The instruction
          never overlaps the face. */}
      <div className="flex flex-col gap-4">
        {/* MESSAGE BAND */}
        <div className="order-1">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-3 shadow-md">
            {(phase === "liveness" || phase === "calibrating") && !inCapture && (
              <div className="mb-2 h-1 overflow-hidden rounded-full bg-white/15">
                <div
                  className={`h-full transition-[width] duration-100 ${
                    phase === "calibrating"
                      ? "bg-sky-400"
                      : amber
                        ? "bg-amber-400"
                        : "bg-emerald-400"
                  }`}
                  style={{
                    width: `${phase === "calibrating" ? calibProgress * 100 : timePct}%`,
                  }}
                />
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider text-white/60">
                {headerLabel}
              </span>
              <div className="flex items-center gap-2">
                {phase === "liveness" && !inSoft && !inCapture && (
                  <span
                    className={`text-[11px] font-semibold tabular-nums ${
                      amber ? "text-amber-300" : "text-white/70"
                    }`}
                  >
                    {paused ? tx("paused") : `${secondsLeft}s`}
                  </span>
                )}
                {phase === "liveness" && !inCapture && displayKind === "blink" && displayActive && (
                  <span
                    key={blinkTick}
                    className="text-[11px] font-semibold text-emerald-300 animate-in zoom-in-50 duration-200"
                  >
                    {tx("blinkProgress", { n: displayActive.blinkCount ?? 0 })}
                  </span>
                )}
                {phase === "liveness" && !inCapture && isSeq && (
                  <span className="text-[10px] font-semibold tabular-nums text-sky-300 ring-1 ring-sky-400/30 rounded-full px-2 py-0.5">
                    {tx("seqProgress", { n: seqStep + 1, t: 2 })}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-1 flex items-center gap-3">
              {/* DEMO LEFT OF MESSAGE */}
              {showDemo && active && (
                <ChallengeDemo kind={displayKind ?? active.kind} done={displayActive?.done ?? active.done} size={56} />
              )}
              {!showDemo && (captureSeq === "success" || captureSeq === "capturing") && (
                <div
                  className="flex shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40"
                  style={{ width: 56, height: 56 }}
                  aria-hidden="true"
                >
                  <CheckCircle2 className="h-7 w-7" />
                </div>
              )}
              {!showDemo && (captureSeq === "lookStraight" || captureSeq === "countdown") && (
                <div
                  className="flex shrink-0 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/20"
                  style={{ width: 56, height: 56 }}
                  aria-hidden="true"
                >
                  {captureSeq === "countdown" && countdown !== null ? (
                    <span className="text-2xl font-bold tabular-nums">{countdown}</span>
                  ) : (
                    <Camera className="h-7 w-7" />
                  )}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold leading-tight text-white sm:text-lg">
                  {instruction}
                </p>
                {meterLine && (
                  <p className="mt-0.5 text-[11px] text-white/70">{meterLine}</p>
                )}
                {phase === "liveness" && !inCapture && (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/15">
                    <div
                      className="h-full bg-emerald-400 transition-[width] duration-100"
                      style={{ width: `${Math.max(0, Math.min(100, meterValue * 100))}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Big countdown number on the right of the message */}
              {captureSeq === "countdown" && countdown !== null && (
                <div
                  key={`big-${countdown}`}
                  className="shrink-0 text-5xl font-black tabular-nums text-emerald-300 animate-in zoom-in-95 duration-200"
                >
                  {countdown}
                </div>
              )}
            </div>

            <p
              className={`mt-2 text-xs ${
                centered ? "text-emerald-200/90" : "text-amber-200/90"
              }`}
            >
              {guidance}
            </p>
            {hintText && !inSoft && (
              <p className="mt-1 text-[11px] text-amber-200/90">{hintText}</p>
            )}

            {/* Step dots inside band (clearer on desktop) */}
            {phase === "liveness" && challenges.length > 0 && (
              <div className="mt-3 flex items-center gap-1.5">
                {challenges.map((c, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${
                      c.done
                        ? "w-6 bg-emerald-400"
                        : i === activeIdx && !inCapture
                          ? "w-6 bg-white/80"
                          : "w-1.5 bg-white/30"
                    }`}
                  />
                ))}
              </div>
            )}

            {isDev && (
              <>
                <p className="mt-2 text-[10px] text-white/40">
                  FPS {fps} · blink {liveReadout.blink.toFixed(2)} · smile {liveReadout.smile.toFixed(2)} · signed yaw {(liveReadout.yaw * DIRECTION.YAW_LEFT_SIGN) >= 0 ? "+" : ""}{(liveReadout.yaw * DIRECTION.YAW_LEFT_SIGN).toFixed(2)} · signed pitch {liveReadout.pitch >= 0 ? "+" : ""}{liveReadout.pitch.toFixed(2)} · yawChange {liveReadout.yawChange >= 0 ? "+" : ""}{liveReadout.yawChange.toFixed(2)} · pitchChange {liveReadout.pitchChange >= 0 ? "+" : ""}{liveReadout.pitchChange.toFixed(2)}
                </p>
                <p className="mt-1 text-[10px] text-white/40">
                  dominant {liveReadout.dominantAxis} · gesture {liveReadout.resolved} · pass {liveReadout.pass ? "YES" : "NO"} · Y±{DIRECTION.YAW_LEFT_SIGN} · mirrored {DIRECTION.MIRRORED ? "yes" : "no"} · idx {integrity.currentIdx} · passed {integrity.passed}/{challenges.length} · refSig {integrity.refCaptured ? "✓" : "—"} · sim {integrity.liveSim.toFixed(2)} · {integrity.decision}
                </p>
                {padReadout && (
                  <p className="mt-1 text-[10px] text-white/40">
                    PAD moiré {padReadout.moire.toFixed(2)} · flicker {padReadout.flicker.toFixed(2)} · planar {padReadout.planar.toFixed(2)} · shoulders {padReadout.shouldersVisible === null ? "—" : padReadout.shouldersVisible ? "✓" : "✗"} ({padReadout.shoulderSpanRatio.toFixed(2)}×face) · active {active?.kind ?? "—"}
                  </p>
                )}
              </>
            )}
          </div>

          {isDev && devOpen && (
            <div className="mt-3">
              <DevPanel />
            </div>
          )}
        </div>

        {/* CAMERA CARD (right on desktop, below on mobile) */}
        <div className="order-2 w-full">
          <div className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-black aspect-[3/4] shadow-xl">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="absolute inset-0 h-full w-full object-cover scale-x-[-1]"
            />
            <canvas
              ref={overlayRef}
              width={400}
              height={533}
              className="absolute inset-0 h-full w-full"
            />
            <canvas ref={sampleRef} className="hidden" />

            {/* Blink flash tick */}
            {phase === "liveness" && !inCapture && active?.kind === "blink" && (
              <div
                key={`tick-${blinkTick}`}
                className="pointer-events-none absolute inset-0 bg-emerald-400/20 opacity-0 animate-in fade-in zoom-in-95"
                style={{
                  animationDuration: "180ms",
                  animationDirection: "alternate",
                  animationIterationCount: 2,
                }}
              />
            )}


            <div
              className={`pointer-events-none absolute inset-0 bg-white transition-opacity duration-150 ${
                flash ? "opacity-70" : "opacity-0"
              }`}
            />

            {/* Big countdown ALSO over the camera so users looking at the lens see it */}
            {captureSeq === "countdown" && countdown !== null && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  key={`cam-cd-${countdown}`}
                  className="rounded-full bg-black/60 px-8 py-5 text-6xl font-black text-white backdrop-blur-sm animate-in zoom-in-90 duration-200"
                >
                  {countdown}
                </div>
              </div>
            )}

            {/* Paused overlay */}
            {paused && !inSoft && phase === "liveness" && !inCapture && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3 rounded-2xl bg-zinc-900/80 px-6 py-5 ring-1 ring-white/10">
                  <Pause className="h-6 w-6 text-white" />
                  <p className="text-sm text-white/80">{tx("paused")}</p>
                  <Button onClick={onTogglePause} className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400">
                    <Play className="mr-2 h-4 w-4" />
                    {tx("resumeBtn")}
                  </Button>
                </div>
              </div>
            )}

            {/* Soft-timeout overlay (per-challenge retry) */}
            {inSoft && phase === "liveness" && !inCapture && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                <div className="w-full max-w-xs space-y-3 rounded-2xl bg-zinc-900/90 px-5 py-5 text-center ring-1 ring-white/10">
                  <p className="text-sm font-semibold text-white">{tx("timeoutSoft")}</p>
                  <p className="text-[11px] text-white/60">{tx("attempt", { n: attempts })}</p>
                  {hintText && <p className="text-xs text-amber-200/90">{hintText}</p>}
                  <Button onClick={onTryAgain} className="w-full bg-emerald-500 text-zinc-950 hover:bg-emerald-400">
                    {tx("tryAgain")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function DevPanel() {
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);
  const Slider = ({ k, min, max, step }: { k: keyof typeof TH; min: number; max: number; step: number }) => (
    <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-300">
      <span className="w-44 truncate">{String(k)}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={TH[k] as number}
        onChange={(e) => {
          (TH as Record<string, number>)[k as string] = parseFloat(e.target.value);
          refresh();
        }}
        className="flex-1"
      />
      <span className="w-12 text-right tabular-nums text-zinc-400">{(TH[k] as number).toFixed(2)}</span>
    </label>
  );
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 space-y-1.5">
      <p className="text-xs font-semibold text-zinc-200">Dev tuning</p>
      <Slider k="BLINK_ABS" min={0.2} max={0.7} step={0.01} />
      <Slider k="BLINK_HIGH_OFFSET" min={0.10} max={0.6} step={0.01} />
      <Slider k="BLINK_LOW_OFFSET" min={0.03} max={0.3} step={0.01} />
      <Slider k="BLINK_REFRACTORY_MS" min={80} max={600} step={10} />
      <Slider k="SMILE_ABS" min={0.15} max={0.6} step={0.01} />
      <Slider k="SMILE_HOLD_MS" min={80} max={600} step={10} />
      <Slider k="SMILE_DELTA" min={0.04} max={0.4} step={0.01} />
      <Slider k="YAW_TURN_ABS" min={0.08} max={0.5} step={0.01} />
      <Slider k="NOSE_TURN_ABS" min={0.06} max={0.4} step={0.01} />
      <Slider k="PITCH_NOD_ABS" min={0.08} max={0.5} step={0.01} />
      <Slider k="NOSE_NOD_ABS" min={0.04} max={0.3} step={0.01} />
      <Slider k="DEPTH_MIN_RATIO" min={0.2} max={0.9} step={0.05} />
    </div>
  );
}


function ResultScreen({
  photoUrl,
  videoUrl,
  videoSupported,
  imageBlob,
  videoBlob,
  submitState,
  submitError,
  onRetake,
  onSubmit,
  onHome,
  tx,
}: {
  photoUrl: string;
  videoUrl: string | null;
  videoSupported: boolean;
  imageBlob: Blob | null;
  videoBlob: Blob | null;
  submitState: "idle" | "uploading" | "ok" | "fail";
  submitError: string;
  onRetake: () => void;
  onSubmit: () => void;
  onHome: () => void;
  tx: Tx;
}) {
  const busy = submitState === "uploading";
  const done = submitState === "ok";
  const failed = submitState === "fail";
  const imgKB = imageBlob ? Math.round(imageBlob.size / 1024) : 0;
  const vidKB = videoBlob ? Math.round(videoBlob.size / 1024) : 0;
  return (
    <section
      className="space-y-4 animate-in fade-in zoom-in-95 duration-300"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-center gap-2 text-emerald-400">
        <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
        <p className="text-sm font-medium">{tx("captureSuccess")}</p>
      </div>

      <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-black">
        <img
          src={photoUrl}
          alt={tx("capturedAlt")}
          className="aspect-[3/4] w-full object-cover"
        />
      </div>

      <p className="text-[11px] text-zinc-500">
        {imgKB} KB image{videoBlob ? ` · ${vidKB} KB video (silent upload)` : ""}
        {!videoSupported && ` · ${tx("videoUnsupported")}`}
      </p>
      <p className="text-[11px] text-zinc-500">{tx("honestLimits")}</p>


      {done && (
        <div className="rounded-xl bg-emerald-500/15 px-4 py-3 text-sm text-emerald-300 ring-1 ring-emerald-400/30">
          {tx("submitOk")}
        </div>
      )}
      {failed && (
        <div className="rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300 ring-1 ring-red-400/30">
          {tx("submitFail")}
          {submitError && <p className="mt-1 text-[11px] text-red-200/70">{submitError}</p>}
        </div>
      )}

      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={done ? onHome : onRetake}
          disabled={busy}
          className="flex-1 border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
        >
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          {done ? tx("back2") : tx("retake")}
        </Button>
        {!done && (
          <Button
            onClick={onSubmit}
            disabled={busy}
            className="flex-1 bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
          >
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-900 border-t-transparent" />
                {tx("uploading")}
              </span>
            ) : failed ? (
              tx("retrySubmit")
            ) : (
              tx("submit")
            )}
          </Button>
        )}
      </div>
    </section>
  );
}


function ErrorScreen({
  msg,
  onRetry,
  onHome,
  tx,
}: {
  msg: string;
  onRetry: () => void;
  onHome: () => void;
  tx: Tx;
}) {
  return (
    <section className="space-y-4 pt-6 text-center animate-in fade-in duration-300">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-red-400">
        <X className="h-6 w-6" aria-hidden="true" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">{tx("failed")}</h2>
        <p className="mt-1 text-sm text-zinc-400">{msg}</p>
      </div>
      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={onHome}
          className="flex-1 border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
        >
          {tx("back2")}
        </Button>
        <Button
          onClick={onRetry}
          className="flex-1 bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
        >
          {tx("retry")}
        </Button>
      </div>
    </section>
  );
}

function drawOverlay(
  canvas: HTMLCanvasElement,
  m: FaceMetrics | null,
  faces: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2;
  const cy = H / 2;
  const rx = W * 0.36;
  const ry = H * 0.42;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const ok = faces === 1 && m && m.centerOffset < 0.18;
  ctx.strokeStyle = ok ? "rgba(52,211,153,0.95)" : "rgba(244,191,79,0.9)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
}


