import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { Camera, CheckCircle2, RotateCcw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CHALLENGE_LABEL,
  type ChallengeKind,
  type ChallengeState,
  computeMetrics,
  frameGuidance,
  newChallengeState,
  pickChallenges,
  updateChallenge,
  avgBrightness,
} from "@/lib/liveness";

export const Route = createFileRoute("/liveface")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "LiveFaceAI — Browser-based face liveness" },
      {
        name: "description",
        content:
          "On-device face liveness detection. Nothing is uploaded — your photo never leaves the browser.",
      },
    ],
  }),
  component: LiveFaceAI,
});

type Step = "start" | "loading" | "liveness" | "result" | "error";
const CHALLENGE_TIMEOUT_MS = 12_000;

function LiveFaceAI() {
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
  const [guidance, setGuidance] = useState("Hold still");
  const [centered, setCentered] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const challengeStartRef = useRef<number>(0);
  const [timeLeft, setTimeLeft] = useState<number>(CHALLENGE_TIMEOUT_MS);
  const [flash, setFlash] = useState(false);

  const stopAll = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);
  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

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
      (blob) => {
        if (!blob) {
          fail("Could not capture frame");
          return;
        }
        setPhotoUrl(URL.createObjectURL(blob));
        stopAll();
        setStep("result");
      },
      "image/jpeg",
      0.92,
    );
  }, [fail, stopAll]);

  const start = useCallback(async () => {
    setErrorMsg("");
    setStep("loading");
    try {
      // Load MediaPipe.
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
      });
      landmarkerRef.current = landmarker;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;

      const chosen = pickChallenges();
      const initial = chosen.map(newChallengeState);
      challengesRef.current = initial;
      setChallengeView(initial);
      setActiveIdx(0);
      challengeStartRef.current = performance.now();
      setTimeLeft(CHALLENGE_TIMEOUT_MS);
      setStep("liveness");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (/Permission|denied|NotAllowed/i.test(msg))
        fail("Camera permission was denied. Allow camera access and try again.");
      else if (/NotFound|no.*camera/i.test(msg))
        fail("No camera was found on this device.");
      else fail(msg);
    }
  }, [fail]);

  // Attach the stream once the video element is mounted in the liveness step.
  useEffect(() => {
    if (step !== "liveness") return;
    const v = videoRef.current;
    if (!v || !streamRef.current) return;
    v.srcObject = streamRef.current;
    v.play().catch(() => {});
  }, [step]);

  // Detection loop.
  useEffect(() => {
    if (step !== "liveness") return;
    let lastTs = -1;
    let cancelled = false;
    let captureScheduled = false;

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
      lastTs = ts;

      let result: FaceLandmarkerResult;
      try {
        result = landmarker.detectForVideo(video, ts);
      } catch {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const faces = result.faceLandmarks?.length ?? 0;
      const m = faces === 1 ? computeMetrics(result.faceLandmarks[0]) : null;

      // Brightness sample from a downscaled draw.
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

      // Draw overlay (oval guide).
      drawOverlay(overlay, m, faces);

      const g = frameGuidance(faces, m, brightness);
      setCentered(g.ok);
      setGuidance(g.text);

      if (g.ok && m) {
        const idx = challengesRef.current.findIndex((c) => !c.done);
        if (idx === -1) {
          if (!captureScheduled) {
            captureScheduled = true;
            let n = 2;
            setCountdown(n);
            const iv = window.setInterval(() => {
              n -= 1;
              if (n <= 0) {
                window.clearInterval(iv);
                setCountdown(null);
                setFlash(true);
                setTimeout(() => setFlash(false), 200);
                // Quality gate: still one face & centered before snapping.
                if (g.ok) capture();
                else captureScheduled = false;
              } else {
                setCountdown(n);
              }
            }, 1000);
          }
        } else {
          const updated = updateChallenge(challengesRef.current[idx], m);
          const wasDone = challengesRef.current[idx].done;
          challengesRef.current[idx] = updated;
          if (updated.done && !wasDone) {
            setChallengeView([...challengesRef.current]);
            challengeStartRef.current = performance.now();
            setActiveIdx(Math.min(idx + 1, challengesRef.current.length - 1));
          }
        }
      }

      // Timeout for the active challenge.
      const activeIndex = challengesRef.current.findIndex((c) => !c.done);
      if (activeIndex !== -1) {
        const elapsed = performance.now() - challengeStartRef.current;
        const remaining = Math.max(0, CHALLENGE_TIMEOUT_MS - elapsed);
        setTimeLeft(remaining);
        if (remaining === 0) {
          fail("Challenge timed out. Please try again.");
          return;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [step, capture, fail]);

  const retake = useCallback(() => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    void start();
  }, [photoUrl, start]);

  const reset = useCallback(() => {
    stopAll();
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    setStep("start");
    setErrorMsg("");
  }, [photoUrl, stopAll]);

  return (
    <main className="min-h-dvh bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-6">
        <header className="flex items-center gap-2 pb-4">
          <ShieldCheck className="h-5 w-5 text-emerald-400" aria-hidden="true" />
          <h1 className="text-lg font-semibold tracking-tight">LiveFaceAI</h1>
        </header>

        {step === "start" && <StartScreen onStart={start} />}
        {step === "loading" && <LoadingScreen />}
        {step === "liveness" && (
          <LivenessScreen
            videoRef={videoRef}
            overlayRef={overlayRef}
            sampleRef={sampleCanvasRef}
            challenges={challengeView}
            activeIdx={activeIdx}
            guidance={guidance}
            centered={centered}
            countdown={countdown}
            timeLeft={timeLeft}
            flash={flash}
            onCancel={reset}
          />
        )}
        {step === "result" && photoUrl && (
          <ResultScreen photoUrl={photoUrl} onRetake={retake} onConfirm={reset} />
        )}
        {step === "error" && <ErrorScreen msg={errorMsg} onRetry={start} onHome={reset} />}

        <footer className="mt-auto pt-6 text-center text-[11px] text-zinc-500">
          Demonstration liveness flow — browser-based 2D active liveness. Nothing is
          uploaded.
        </footer>
      </div>
    </main>
  );
}

function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <section className="space-y-6 pt-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Verify it's really you
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          We'll run a quick liveness check using your camera. Your photo and video
          never leave this device.
        </p>
      </div>
      <ol className="space-y-3 text-sm">
        {[
          "Allow camera access",
          "Center your face in the oval",
          "Complete 3 randomized challenges",
          "We'll auto-capture your photo",
        ].map((t, i) => (
          <li key={t} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-semibold text-emerald-400">
              {i + 1}
            </span>
            <span className="text-zinc-300">{t}</span>
          </li>
        ))}
      </ol>
      <Button
        size="lg"
        onClick={onStart}
        className="w-full bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
      >
        <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
        Start verification
      </Button>
    </section>
  );
}

function LoadingScreen() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-400">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
      <p className="text-sm">Loading on-device model…</p>
    </div>
  );
}

function LivenessScreen({
  videoRef,
  overlayRef,
  sampleRef,
  challenges,
  activeIdx,
  guidance,
  centered,
  countdown,
  timeLeft,
  flash,
  onCancel,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  sampleRef: React.RefObject<HTMLCanvasElement | null>;
  challenges: ChallengeState[];
  activeIdx: number;
  guidance: string;
  centered: boolean;
  countdown: number | null;
  timeLeft: number;
  flash: boolean;
  onCancel: () => void;
}) {
  const active = challenges[activeIdx];
  const instruction = active ? CHALLENGE_LABEL[active.kind] : "All set!";
  const stepNum = Math.min(activeIdx + 1, challenges.length);
  const timePct = Math.max(0, Math.min(100, (timeLeft / CHALLENGE_TIMEOUT_MS) * 100));

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>
          Step {stepNum} of {challenges.length}
        </span>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-zinc-900"
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
        </button>
      </div>

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
        <div
          className={`pointer-events-none absolute inset-0 bg-white transition-opacity duration-150 ${
            flash ? "opacity-70" : "opacity-0"
          }`}
        />
        {countdown !== null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-full bg-black/60 px-6 py-4 text-5xl font-bold text-white backdrop-blur-sm">
              {countdown}
            </div>
          </div>
        )}
        <div className="absolute inset-x-0 top-0 p-3">
          <div className="h-1 overflow-hidden rounded-full bg-zinc-700/60">
            <div
              className="h-full bg-emerald-400 transition-[width] duration-100"
              style={{ width: `${timePct}%` }}
            />
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-4 text-center">
          <p
            className={`mx-auto inline-block rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur-sm ${
              centered
                ? "bg-emerald-500/20 text-emerald-200"
                : "bg-amber-500/20 text-amber-200"
            }`}
          >
            {guidance}
          </p>
        </div>
      </div>

      <div
        key={activeIdx}
        className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-center animate-in fade-in slide-in-from-bottom-2 duration-300"
      >
        <p className="text-xs uppercase tracking-wider text-zinc-500">
          Challenge
        </p>
        <p className="mt-1 text-xl font-semibold">{instruction}</p>
        {active?.kind === "blink" && (
          <p className="mt-1 text-xs text-zinc-400">
            Blinks detected: {active.blinkCount ?? 0} / 2
          </p>
        )}
      </div>

      <ul className="flex items-center justify-center gap-3" aria-label="Progress">
        {challenges.map((c, i) => (
          <li
            key={i}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
              c.done
                ? "bg-emerald-500/15 text-emerald-300"
                : i === activeIdx
                  ? "bg-zinc-800 text-zinc-200"
                  : "bg-zinc-900 text-zinc-500"
            }`}
          >
            {c.done ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <span className="h-3.5 w-3.5 rounded-full border border-current" />
            )}
            {CHALLENGE_LABEL[c.kind].split(" ")[0]}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResultScreen({
  photoUrl,
  onRetake,
  onConfirm,
}: {
  photoUrl: string;
  onRetake: () => void;
  onConfirm: () => void;
}) {
  return (
    <section
      className="space-y-4 animate-in fade-in zoom-in-95 duration-300"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-center gap-2 text-emerald-400">
        <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
        <p className="text-sm font-medium">Liveness verified</p>
      </div>
      <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-black">
        <img
          src={photoUrl}
          alt="Captured selfie after passing liveness check"
          className="aspect-[3/4] w-full object-cover"
        />
      </div>
      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={onRetake}
          className="flex-1 border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
        >
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          Retake
        </Button>
        <Button
          onClick={onConfirm}
          className="flex-1 bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
        >
          Confirm
        </Button>
      </div>
    </section>
  );
}

function ErrorScreen({
  msg,
  onRetry,
  onHome,
}: {
  msg: string;
  onRetry: () => void;
  onHome: () => void;
}) {
  return (
    <section className="space-y-4 pt-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-red-400">
        <X className="h-6 w-6" aria-hidden="true" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">Verification failed</h2>
        <p className="mt-1 text-sm text-zinc-400">{msg}</p>
      </div>
      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={onHome}
          className="flex-1 border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
        >
          Back
        </Button>
        <Button
          onClick={onRetry}
          className="flex-1 bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
        >
          Try again
        </Button>
      </div>
    </section>
  );
}

function drawOverlay(
  canvas: HTMLCanvasElement,
  m: ReturnType<typeof computeMetrics> | null,
  faces: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Dim outside the oval.
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

  // Oval ring.
  const ok = faces === 1 && m && m.centerOffset < 0.18;
  ctx.strokeStyle = ok ? "rgba(52,211,153,0.95)" : "rgba(244,191,79,0.9)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
}

const CHALLENGE_TIMEOUT_MS_EXPORT = CHALLENGE_TIMEOUT_MS;
export { CHALLENGE_TIMEOUT_MS_EXPORT };