import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const LiveFaceAI = lazy(() =>
  import("@/components/liveface-app").then((m) => ({ default: m.LiveFaceAI })),
);

function EngineSkeleton() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <div className="h-10 w-10 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        <div>Preparing camera…</div>
      </div>
    </div>
  );
}

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
    links: [
      { rel: "preconnect", href: "https://cdn.jsdelivr.net", crossOrigin: "anonymous" },
      { rel: "preconnect", href: "https://storage.googleapis.com", crossOrigin: "anonymous" },
    ],
  }),
  component: () => (
    <Suspense fallback={<EngineSkeleton />}>
      <LiveFaceAI />
    </Suspense>
  ),
});
