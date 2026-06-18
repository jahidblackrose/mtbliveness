import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function SelfieCapture({
  busy,
  onCapture,
}: {
  busy: boolean;
  onCapture: (blob: Blob) => void | Promise<void>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStreaming(false);
  }, []);

  const startStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStreaming(true);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Camera unavailable: ${err.message}`
          : "Camera unavailable",
      );
    }
  }, []);

  useEffect(() => {
    void startStream();
    return () => stopStream();
  }, [startStream, stopStream]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Mirror so the saved image matches what the user saw
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(blob));
        stopStream();
        void onCapture(blob);
      },
      "image/jpeg",
      0.9,
    );
  }, [onCapture, previewUrl, stopStream]);

  const retake = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    void startStream();
  }, [previewUrl, startStream]);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border bg-black aspect-[4/3]">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Captured selfie preview"
            className="h-full w-full object-cover"
          />
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover scale-x-[-1]"
            aria-label="Live camera feed"
          />
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>
      {previewUrl ? (
        <Button
          type="button"
          variant="outline"
          onClick={retake}
          disabled={busy}
          className="w-full"
        >
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          Retake
        </Button>
      ) : (
        <Button
          type="button"
          onClick={capture}
          disabled={!streaming || busy}
          className="w-full"
        >
          <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
          Capture selfie
        </Button>
      )}
    </div>
  );
}