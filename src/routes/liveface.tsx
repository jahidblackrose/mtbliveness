import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { Camera, CheckCircle2, Languages, Pause, Play, RotateCcw, ShieldCheck, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type ChallengeState,
  type ChallengeKind,
  type Baseline,
  type FaceMetrics,
  type CalibAccumulator,
  computeMetrics,
  frameGuidance,
  newChallengeState,
  pickChallenges,
  updateChallenge,
  avgBrightness,
  accumulate,
  finalizeBaseline,
  emptyAccumulator,
  setEasyMode,
  EASY,
  TH,
  SpoofGuard,
} from "@/lib/liveness";
import {
  CHALLENGE_KEY,
  GUIDANCE_KEY,
  type Lang,
  t,
} from "@/lib/liveness-i18n";
import { ChallengeDemo } from "@/components/challenge-demo";

export const Route = createFileRoute("/liveface")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "LiveFaceAI — Browser-based face liveness" },
      {
        name: "description",
        content:
          "On-device active face liveness with Bangla & English support. Nothing is uploaded — your photo never leaves the browser.",
      },
    ],
  }),
  component: LiveFaceAI,
});

import { API_ENDPOINT, API_KEY, CONFIG } from "@/lib/liveness-config";

type Step = "start" | "loading" | "framing" | "calibrating" | "liveness" | "result" | "error";


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


function LiveFaceAI() {
  const [lang, setLang] = useState<Lang>("bn");
  const langRef = useRef<Lang>("bn");
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
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
  const sessionStartRef = useRef<number>(0);
  const challengeRunningMsRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  const [fps, setFps] = useState(0);
  const fpsAccumRef = useRef<{ frames: number; lastReport: number }>({ frames: 0, lastReport: 0 });

  const [devOpen, setDevOpen] = useState(false);
  const isDev = useMemo(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("dev"), []);

  // Post-pass capture sequence: success → lookStraight → countdown → capturing
  type CaptureSeq = "idle" | "success" | "lookStraight" | "countdown" | "capturing";
  const [captureSeq, setCaptureSeq] = useState<CaptureSeq>("idle");
  const captureSeqRef = useRef<CaptureSeq>("idle");
  useEffect(() => { captureSeqRef.current = captureSeq; }, [captureSeq]);
  const [bigCountdown, setBigCountdown] = useState<number | null>(null);
  const lookStraightHoldRef = useRef<number | null>(null);
  const lastFramingOkRef = useRef(false);
  const captureIntervalRef = useRef<number | null>(null);

  const [liveReadout, setLiveReadout] = useState({ blink: 0, smile: 0, yaw: 0, pitch: 0 });
  const readoutAccumRef = useRef(0);

  const currentTimeoutMs = easyMode ? CONFIG.EASY_CHALLENGE_TIMEOUT_MS : CONFIG.CHALLENGE_TIMEOUT_MS;
  const currentTimeoutRef = useRef(CONFIG.CHALLENGE_TIMEOUT_MS);
  useEffect(() => { currentTimeoutRef.current = currentTimeoutMs; }, [currentTimeoutMs]);

  const hintKeyFor = (k: ChallengeKind) =>
    k === "blink" ? "hintBlink" : k === "smile" ? "hintSmile" : k === "nod" ? "hintNod" : "hintTurn";

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
        resolve(new Blob(parts, { type: mime }));
      };
      if (rec.state === "inactive") {
        finalize();
        return;
      }
      rec.onstop = () => finalize();
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
        if (vb) {
          setVideoBlob(vb);
          setVideoUrl(URL.createObjectURL(vb));
        } else {
          setVideoBlob(null);
        }
        setStep("result");
      },
      "image/jpeg",
      0.92,
    );
  }, [assembleVideo, fail]);


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

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
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
      challengeRunningMsRef.current = 0;
      sessionStartRef.current = performance.now();
      setStep("framing");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      const L = langRef.current;
      if (/Permission|denied|NotAllowed/i.test(msg)) fail(t("permDenied", L));
      else if (/NotFound|no.*camera/i.test(msg)) fail(t("noCamera", L));
      else fail(msg);
    }
  }, [fail, startRecorder, videoUrl]);

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
    const chosen = pickChallenges();
    const now = performance.now();
    const initial = chosen.map((k) => newChallengeState(k, now));
    challengesRef.current = initial;
    attemptsRef.current = initial.map(() => 0);
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
    const idx = softTimeoutRef.current;
    if (idx == null) return;
    const cur = challengesRef.current[idx];
    if (!cur) return;
    const now = performance.now();
    challengesRef.current[idx] = newChallengeState(cur.kind, now);
    setChallengeView([...challengesRef.current]);
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
        setLiveReadout({
          blink: m.blinkMax,
          smile: m.smileMax,
          yaw: m.yaw,
          pitch: m.pitch,
        });
      }

      captureBufRef.current.push({ ts, brightness, centered: g.ok });
      if (captureBufRef.current.length > CONFIG.CAPTURE_BUFFER) captureBufRef.current.shift();

      const currentStep = stepRef.current;

      if ((currentStep === "calibrating" || currentStep === "liveness") && faces > 1) {
        fail(t("secondFace", langRef.current));
        return;
      }

      if (currentStep === "framing") {
        if (g.ok && m) {
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
          if (seq === "idle") {
            captureSeqRef.current = "success";
            setCaptureSeq("success");
            window.setTimeout(() => {
              if (stepRef.current !== "liveness") return;
              if (captureSeqRef.current !== "success") return;
              captureSeqRef.current = "lookStraight";
              setCaptureSeq("lookStraight");
              lookStraightHoldRef.current = null;
            }, 900);
          } else if (seq === "lookStraight") {
            const frontal =
              !!m && g.ok && Math.abs(m.yaw) < 0.18 && Math.abs(m.pitch) < 0.18;
            if (frontal) {
              if (lookStraightHoldRef.current == null) lookStraightHoldRef.current = ts;
              if (ts - lookStraightHoldRef.current >= 500) {
                captureSeqRef.current = "countdown";
                setCaptureSeq("countdown");
                let n = 3;
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
                    setTimeout(() => setFlash(false), 200);
                    if (stepRef.current === "liveness") capture();
                  } else {
                    setBigCountdown(n);
                  }
                }, 1000);
                captureIntervalRef.current = iv;
              }
            } else {
              lookStraightHoldRef.current = null;
            }
          }
        } else if (canRun && m && baseline) {
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
              setHintText(t(hintKeyFor(cur.kind) as Parameters<typeof t>[0], L));

              // Enable easy mode immediately after the first miss.
              if (a >= 1 && !EASY.on) {
                setEasyMode(true);
                setEasyModeState(true);
              }


              if (a >= CONFIG.MAX_ATTEMPTS) {
                // If at least one challenge already passed, accept and proceed.
                const passed = challengesRef.current.filter((c) => c.done).length;
                if (passed >= 1) {
                  challengesRef.current.forEach((c, i) => {
                    if (i >= idx) challengesRef.current[i] = { ...c, done: true };
                  });
                  setChallengeView([...challengesRef.current]);
                  challengeRunningMsRef.current = 0;
                  return;
                }
                fail(t("failed", L));
                return;
              }
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

    // If we still have a live stream, just rerun the post-pass capture
    // (challenges already passed). Otherwise fall back to a full start.
    const stream = streamRef.current;
    if (stream && stream.getTracks().some((t) => t.readyState === "live")) {
      startRecorder(stream);
      // Mark all challenges done, jump to lookStraight + 3-2-1
      challengesRef.current = challengesRef.current.map((c) => ({ ...c, done: true }));
      setChallengeView([...challengesRef.current]);
      captureSeqRef.current = "lookStraight";
      setCaptureSeq("lookStraight");
      setBigCountdown(null);
      lookStraightHoldRef.current = null;
      if (captureIntervalRef.current != null) {
        window.clearInterval(captureIntervalRef.current);
        captureIntervalRef.current = null;
      }
      setStep("liveness");
      return;
    }
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

  const buildMeta = useCallback(() => {
    const session = sessionMetaRef.current;
    return {
      sessionId: session?.sessionId ?? null,
      timestamp: new Date().toISOString(),
      startedAt: session?.startedAt ?? null,
      challengesIssued: challengesRef.current.map((c, i) => ({ order: i, kind: c.kind })),
      perChallengeResult: challengesRef.current.map((c) => ({
        kind: c.kind,
        done: c.done,
        blinkCount: c.blinkCount ?? 0,
        smileIntensity: c.smileIntensity ?? 0,
        poseProgress: c.poseProgress ?? 0,
        parallaxOk: c.parallaxOk ?? null,
      })),
      blinkCount: challengesRef.current
        .filter((c) => c.kind === "blink")
        .reduce((s, c) => s + (c.blinkCount ?? 0), 0),
      livenessScore: challengesRef.current.length
        ? challengesRef.current.filter((c) => c.done).length / challengesRef.current.length
        : 0,
      language: langRef.current,
      easyModeUsed: easyMode,
      videoSupported,
      videoMime: recorderMimeRef.current ?? null,
      spoofFlags: [] as string[],
    };
  }, [easyMode, videoSupported]);

  const submit = useCallback(async () => {
    if (!imageBlob) return;
    setSubmitState("uploading");
    setSubmitError("");
    const fd = new FormData();
    fd.append("image", imageBlob, "selfie.jpg");
    if (videoBlob) fd.append("video", videoBlob, "liveness.webm");
    fd.append("meta", JSON.stringify(buildMeta()));

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



  const langClass = useMemo(
    () => (lang === "bn" ? "font-bangla" : "font-sans"),
    [lang],
  );

  return (
    <main
      className={`min-h-dvh bg-zinc-950 text-zinc-100 ${langClass}`}
      style={{
        fontFamily:
          lang === "bn"
            ? "'Noto Sans Bengali', 'Inter', system-ui, sans-serif"
            : "'Inter', system-ui, sans-serif",
      }}
    >
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-6 lg:max-w-5xl lg:px-6">
        <header className="flex items-center justify-between gap-2 pb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" aria-hidden="true" />
            <h1 className="text-lg font-semibold tracking-tight">{tx("appName")}</h1>
          </div>
          <LangToggle lang={lang} onChange={setLang} />
        </header>

        {step === "start" && <StartScreen onStart={start} tx={tx} />}
        {step === "loading" && <LoadingScreen tx={tx} />}
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
            isDev={isDev}
            devOpen={devOpen}
            onToggleDev={() => setDevOpen((v) => !v)}
            onCancel={reset}
            tx={tx}
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

function StartScreen({ onStart, tx }: { onStart: () => void; tx: Tx }) {
  return (
    <section className="space-y-6 pt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{tx("startTitle")}</h2>
        <p className="mt-2 text-sm text-zinc-400">{tx("startSubtitle")}</p>
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
  isDev,
  devOpen,
  onToggleDev,
  onCancel,
  tx,
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
  liveReadout: { blink: number; smile: number; yaw: number; pitch: number };
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
  isDev: boolean;
  devOpen: boolean;
  onToggleDev: () => void;
  onCancel: () => void;
  tx: Tx;
}) {
  const active = challenges[activeIdx];
  const totalSteps = challenges.length || 3;
  const stepNum = phase === "liveness" ? Math.min(activeIdx + 1, totalSteps) : 0;
  const timePct = Math.max(0, Math.min(100, (timeLeft / Math.max(1, timeoutMs)) * 100));
  const secondsLeft = Math.ceil(timeLeft / 1000);
  const amber = phase === "liveness" && timeLeft > 0 && timeLeft <= 5000;
  const inSoft = softTimeoutIdx != null;
  const inCapture = phase === "liveness" && captureSeq !== "idle";

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
  else if (active) instruction = tx(CHALLENGE_KEY[active.kind]);
  else instruction = tx("allSet");

  let meterLine: string | null = null;
  let meterValue = 0;
  if (phase === "liveness" && !inCapture && active) {
    if (active.kind === "blink") {
      meterLine = tx("blinkProgress", { n: active.blinkCount ?? 0 });
      meterValue = blinkMeter;
    } else if (active.kind === "smile") {
      meterLine = (active.smileHoldStart ?? 0) > 0 ? tx("smileHold") : tx("showSmile");
      meterValue = Math.max(smileMeter, active.smileIntensity ?? 0);
    } else {
      meterLine = tx("slowSteady");
      meterValue = Math.max(poseMeter, active.poseProgress ?? 0);
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start lg:gap-6">
        {/* MESSAGE BAND */}
        <div className="order-1 lg:order-1">
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
                {phase === "liveness" && !inCapture && active?.kind === "blink" && (
                  <span
                    key={blinkTick}
                    className="text-[11px] font-semibold text-emerald-300 animate-in zoom-in-50 duration-200"
                  >
                    {tx("blinkProgress", { n: active.blinkCount ?? 0 })}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-1 flex items-center gap-3">
              {/* DEMO LEFT OF MESSAGE */}
              {showDemo && active && (
                <ChallengeDemo kind={active.kind} done={active.done} size={56} />
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
              <p className="mt-2 text-[10px] text-white/40">
                FPS {fps} · blink {liveReadout.blink.toFixed(2)} · smile {liveReadout.smile.toFixed(2)} · yaw {liveReadout.yaw.toFixed(2)} · pitch {liveReadout.pitch.toFixed(2)}
              </p>
            )}
          </div>

          {isDev && devOpen && (
            <div className="mt-3">
              <DevPanel />
            </div>
          )}
        </div>

        {/* CAMERA CARD (right on desktop, below on mobile) */}
        <div className="order-2 lg:order-2 lg:justify-self-end w-full">
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

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-black">
          <img
            src={photoUrl}
            alt={tx("capturedAlt")}
            className="aspect-[3/4] w-full object-cover"
          />
        </div>
        <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-black">
          {videoUrl ? (
            <video
              src={videoUrl}
              controls
              playsInline
              className="aspect-[3/4] w-full object-cover bg-black"
            />
          ) : (
            <div className="flex aspect-[3/4] w-full items-center justify-center px-4 text-center text-xs text-zinc-400">
              {tx("videoUnsupported")}
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-zinc-500">
        {tx("videoLabel")} · {imgKB} KB image{videoBlob ? ` · ${vidKB} KB video` : ""}
        {!videoSupported && ` · ${tx("videoUnsupported")}`}
      </p>

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
