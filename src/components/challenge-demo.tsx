import type { ChallengeKind } from "@/lib/liveness";

/**
 * Small looping SVG demo of the requested action.
 * ~48px, sits to the left of the instruction text in the top band.
 * When `done` is true, shows a green ✓ instead of the animation.
 */
export function ChallengeDemo({
  kind,
  done,
  size = 48,
}: {
  kind: ChallengeKind;
  done?: boolean;
  size?: number;
}) {
  if (done) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none">
          <path
            d="M5 12l4 4 10-10"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/20"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {kind === "blink" && <EyeDemo size={size} />}
      {kind === "smile" && <SmileDemo size={size} />}
      {kind === "turnLeft" && <TurnDemo size={size} direction="left" />}
      {kind === "turnRight" && <TurnDemo size={size} direction="right" />}
      {kind === "nod" && <NodDemo size={size} />}
      {kind === "lookUp" && <LookDemo size={size} direction="up" />}
      {kind === "lookDown" && <LookDemo size={size} direction="down" />}
      {kind === "mouthOpen" && <MouthOpenDemo size={size} />}
      
      {kind === "randomSequence" && <RandomSeqDemo size={size} />}
      {kind === "readDigits" && <RandomSeqDemo size={size} />}
    </div>
  );
}

function EyeDemo({ size }: { size: number }) {
  const s = size * 0.7;
  return (
    <svg viewBox="0 0 40 40" width={s} height={s} aria-hidden="true">
      <style>{`
        @keyframes lf-blink { 0%,40%,100% { transform: scaleY(1) } 45%,55% { transform: scaleY(0.05) } }
        .lf-eye { transform-origin: 20px 20px; animation: lf-blink 1.6s ease-in-out infinite; }
      `}</style>
      <g className="lf-eye" stroke="currentColor" strokeWidth="2" fill="none">
        <path d="M4 20 Q20 6 36 20 Q20 34 4 20 Z" />
        <circle cx="20" cy="20" r="5" fill="currentColor" />
      </g>
    </svg>
  );
}

function SmileDemo({ size }: { size: number }) {
  const s = size * 0.7;
  return (
    <svg viewBox="0 0 40 40" width={s} height={s} aria-hidden="true">
      <style>{`
        @keyframes lf-smile { 0%,100% { d: path("M12 24 Q20 26 28 24"); } 50% { d: path("M12 22 Q20 32 28 22"); } }
        .lf-mouth { animation: lf-smile 1.6s ease-in-out infinite; }
      `}</style>
      <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="2" fill="none" />
      <circle cx="14" cy="17" r="1.6" fill="currentColor" />
      <circle cx="26" cy="17" r="1.6" fill="currentColor" />
      <path
        className="lf-mouth"
        d="M12 24 Q20 26 28 24"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function TurnDemo({ size, direction }: { size: number; direction: "left" | "right" }) {
  const s = size * 0.7;
  // Mirrored selfie view: user's left looks like image right.
  // Match the on-screen mirror so the animation aligns with what the user sees.
  const sign = direction === "left" ? 1 : -1;
  return (
    <svg viewBox="0 0 40 40" width={s} height={s} aria-hidden="true">
      <style>{`
        @keyframes lf-turn-${direction} {
          0%,100% { transform: rotateY(0deg); }
          50% { transform: rotateY(${sign * 35}deg); }
        }
        .lf-head-${direction} {
          transform-origin: 20px 20px;
          transform-style: preserve-3d;
          animation: lf-turn-${direction} 1.8s ease-in-out infinite;
        }
      `}</style>
      <g className={`lf-head-${direction}`} stroke="currentColor" strokeWidth="2" fill="none">
        <ellipse cx="20" cy="20" rx="10" ry="13" />
        <circle cx="16" cy="18" r="1.2" fill="currentColor" />
        <circle cx="24" cy="18" r="1.2" fill="currentColor" />
        <path d="M16 26 Q20 28 24 26" strokeLinecap="round" />
      </g>
      <path
        d={direction === "left" ? "M4 32 L10 30 L8 34 Z" : "M36 32 L30 30 L32 34 Z"}
        fill="currentColor"
        opacity="0.7"
      />
    </svg>
  );
}

function NodDemo({ size }: { size: number }) {
  const s = size * 0.7;
  return (
    <svg viewBox="0 0 40 40" width={s} height={s} aria-hidden="true">
      <style>{`
        @keyframes lf-nod {
          0%,100% { transform: translateY(0) rotateX(0deg); }
          25% { transform: translateY(2px) rotateX(20deg); }
          75% { transform: translateY(-2px) rotateX(-20deg); }
        }
        .lf-head-nod {
          transform-origin: 20px 20px;
          animation: lf-nod 1.8s ease-in-out infinite;
        }
      `}</style>
      <g className="lf-head-nod" stroke="currentColor" strokeWidth="2" fill="none">
        <ellipse cx="20" cy="20" rx="10" ry="13" />
        <circle cx="16" cy="18" r="1.2" fill="currentColor" />
        <circle cx="24" cy="18" r="1.2" fill="currentColor" />
        <path d="M16 26 Q20 28 24 26" strokeLinecap="round" />
      </g>
      <path d="M20 3 L17 7 L23 7 Z" fill="currentColor" opacity="0.7" />
      <path d="M20 37 L17 33 L23 33 Z" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

function LookDemo({ size, direction }: { size: number; direction: "up" | "down" }) {
  const s = size * 0.7;
  const sign = direction === "up" ? -1 : 1;
  return (
    <svg viewBox="0 0 40 40" width={s} height={s} aria-hidden="true">
      <style>{`
        @keyframes lf-look-${direction} {
          0%,100% { transform: translateY(0) rotateX(0deg); }
          50% { transform: translateY(${sign * 2}px) rotateX(${sign * 25}deg); }
        }
        .lf-head-look-${direction} {
          transform-origin: 20px 20px;
          animation: lf-look-${direction} 1.6s ease-in-out infinite;
        }
      `}</style>
      <g className={`lf-head-look-${direction}`} stroke="currentColor" strokeWidth="2" fill="none">
        <ellipse cx="20" cy="20" rx="10" ry="13" />
        <circle cx="16" cy="18" r="1.2" fill="currentColor" />
        <circle cx="24" cy="18" r="1.2" fill="currentColor" />
        <path d="M16 26 Q20 28 24 26" strokeLinecap="round" />
      </g>
      <path
        d={direction === "up" ? "M20 3 L17 7 L23 7 Z" : "M20 37 L17 33 L23 33 Z"}
        fill="currentColor"
        opacity="0.8"
      />
    </svg>
  );
}

function MouthOpenDemo({ size }: { size: number }) {
  const s = size * 0.7;
  return (
    <svg viewBox="0 0 40 40" width={s} height={s} aria-hidden="true">
      <style>{`
        @keyframes lf-mouth-open { 0%,100% { ry: 1.5; } 50% { ry: 5.5; } }
        .lf-mouth-o { animation: lf-mouth-open 1.4s ease-in-out infinite; transform-origin: 20px 25px; }
      `}</style>
      <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="2" fill="none" />
      <circle cx="14" cy="17" r="1.6" fill="currentColor" />
      <circle cx="26" cy="17" r="1.6" fill="currentColor" />
      <ellipse className="lf-mouth-o" cx="20" cy="25" rx="5" ry="1.5" fill="currentColor" />
    </svg>
  );
}


function RandomSeqDemo({ size }: { size: number }) {
  const s = size * 0.7;
  return (
    <svg viewBox="0 0 40 40" width={s} height={s} aria-hidden="true">
      <style>{`
        @keyframes lf-seq { 0%,40%{opacity:1} 50%,100%{opacity:0.25} }
        @keyframes lf-seq2 { 0%,40%{opacity:0.25} 50%,100%{opacity:1} }
      `}</style>
      <text x="8" y="25" fill="currentColor" fontSize="14" style={{ animation: "lf-seq 1.8s ease-in-out infinite" }}>1</text>
      <text x="18" y="25" fill="currentColor" fontSize="14" opacity="0.4">→</text>
      <text x="28" y="25" fill="currentColor" fontSize="14" style={{ animation: "lf-seq2 1.8s ease-in-out infinite" }}>2</text>
    </svg>
  );
}


