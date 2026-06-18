import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { CheckCircle2, LogOut, Phone, ShieldCheck, ScanFace } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { supabase } from "@/integrations/supabase/client";
import { generateOtp, isValidPhone } from "@/lib/phone";
import { SelfieCapture } from "@/components/selfie-capture";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "MTB eKYC" },
      { name: "description", content: "MTB eKYC — verify your identity with Google sign-in, mobile OTP, and a live selfie." },
    ],
  }),
  component: Index,
});

type Profile = {
  phone: string | null;
  phone_verified: boolean;
  selfie_path: string | null;
  kyc_completed: boolean;
};
type Step = "loading" | "phone" | "otp" | "selfie" | "completed";

const EMPTY_PROFILE: Profile = {
  phone: null,
  phone_verified: false,
  selfie_path: null,
  kyc_completed: false,
};

function Index() {
  const navigate = useNavigate();
  const phoneInputId = useId();
  const otpLabelId = useId();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [step, setStep] = useState<Step>("loading");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const expectedOtpRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        navigate({ to: "/auth", replace: true });
        return;
      }
      setUser(data.user);
      const { data: p } = await supabase
        .from("profiles")
        .select("phone, phone_verified, selfie_path, kyc_completed")
        .eq("id", data.user.id)
        .maybeSingle();
      if (cancelled) return;
      const prof = (p as Profile | null) ?? EMPTY_PROFILE;
      setProfile(prof);
      setPhone(prof.phone ?? "");
      if (prof.kyc_completed) {
        setStep("completed");
      } else if (prof.phone_verified) {
        setStep("selfie");
      } else {
        setStep("phone");
      }
      if (prof.selfie_path) {
        const { data: signed } = await supabase.storage
          .from("kyc-selfies")
          .createSignedUrl(prof.selfie_path, 60 * 10);
        if (!cancelled && signed?.signedUrl) setSelfieUrl(signed.signedUrl);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const sendOtp = useCallback(() => {
    if (!isValidPhone(phone)) {
      toast.error("Enter a valid phone number (8–15 digits, optional +)");
      return;
    }
    const code = generateOtp();
    expectedOtpRef.current = code;
    setOtp("");
    setStep("otp");
    toast.success(`Demo OTP: ${code}`, {
      description: "In a real app this would be sent via SMS.",
      duration: 15000,
    });
  }, [phone]);

  const verifyOtp = useCallback(async () => {
    if (otp.length !== 6) {
      toast.error("Enter the 6-digit code");
      return;
    }
    if (otp !== expectedOtpRef.current) {
      toast.error("Incorrect code, try again");
      return;
    }
    if (!user) return;
    setBusy(true);
    const trimmed = phone.trim();
    const { error } = await supabase
      .from("profiles")
      .update({ phone: trimmed, phone_verified: true, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    expectedOtpRef.current = "";
    setProfile((p) => ({ ...p, phone: trimmed, phone_verified: true }));
    setStep("selfie");
    toast.success("Phone number verified");
  }, [otp, phone, user]);

  const uploadSelfie = useCallback(
    async (blob: Blob) => {
      if (!user) return;
      setBusy(true);
      const path = `${user.id}/selfie-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("kyc-selfies")
        .upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (upErr) {
        setBusy(false);
        toast.error(upErr.message);
        return;
      }
      const { error: dbErr } = await supabase
        .from("profiles")
        .update({
          selfie_path: path,
          kyc_completed: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);
      if (dbErr) {
        setBusy(false);
        toast.error(dbErr.message);
        return;
      }
      const { data: signed } = await supabase.storage
        .from("kyc-selfies")
        .createSignedUrl(path, 60 * 10);
      setBusy(false);
      setProfile((p) => ({ ...p, selfie_path: path, kyc_completed: true }));
      setSelfieUrl(signed?.signedUrl ?? null);
      setStep("completed");
      toast.success("eKYC complete");
    },
    [user],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }, [navigate]);

  const restartKyc = useCallback(async () => {
    if (!user) return;
    await supabase
      .from("profiles")
      .update({ phone_verified: false, kyc_completed: false })
      .eq("id", user.id);
    setProfile((p) => ({ ...p, phone_verified: false, kyc_completed: false }));
    setOtp("");
    expectedOtpRef.current = "";
    setStep("phone");
  }, [user]);

  if (step === "loading") {
    return (
      <main
        className="flex min-h-dvh items-center justify-center text-muted-foreground"
        aria-busy="true"
      >
        Loading…
      </main>
    );
  }

  const displayName = user?.user_metadata?.full_name ?? user?.email ?? "there";
  const stepIndex =
    step === "phone" ? 1 : step === "otp" ? 2 : step === "selfie" ? 3 : 3;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            MTB eKYC
          </p>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate text-xl">Welcome, {displayName}</CardTitle>
              <CardDescription className="break-all">{user?.email}</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              aria-label="Sign out"
              className="min-h-11 min-w-11"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          {step !== "completed" && (
            <p
              className="pt-2 text-xs text-muted-foreground"
              aria-label={`Step ${stepIndex} of 3`}
            >
              Step {stepIndex} of 3
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "phone" && (
            <PhoneStep
              inputId={phoneInputId}
              phone={phone}
              onPhoneChange={setPhone}
              onSubmit={sendOtp}
            />
          )}
          {step === "otp" && (
            <OtpStep
              labelId={otpLabelId}
              phone={phone}
              otp={otp}
              onOtpChange={setOtp}
              onBack={() => setStep("phone")}
              onVerify={verifyOtp}
              busy={busy}
            />
          )}
          {step === "selfie" && (
            <SelfieStep busy={busy} onCapture={uploadSelfie} />
          )}
          {step === "completed" && (
            <CompletedStep
              phone={profile.phone}
              selfieUrl={selfieUrl}
              onRestart={restartKyc}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function PhoneStep({
  inputId,
  phone,
  onPhoneChange,
  onSubmit,
}: {
  inputId: string;
  phone: string;
  onPhoneChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={inputId} className="flex items-center gap-2">
          <Phone className="h-4 w-4" aria-hidden="true" /> Mobile number
        </Label>
        <Input
          id={inputId}
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="+15551234567"
          value={phone}
          onChange={(e) => onPhoneChange(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full">Send OTP</Button>
    </form>
  );
}

function OtpStep({
  labelId,
  phone,
  otp,
  onOtpChange,
  onBack,
  onVerify,
  busy,
}: {
  labelId: string;
  phone: string;
  otp: string;
  onOtpChange: (v: string) => void;
  onBack: () => void;
  onVerify: () => void;
  busy: boolean;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onVerify();
      }}
    >
      <div className="space-y-2">
        <p id={labelId} className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Enter the 6-digit code sent to {phone}
        </p>
        <div className="flex justify-center pt-2">
          <InputOTP
            maxLength={6}
            value={otp}
            onChange={onOtpChange}
            autoFocus
            aria-labelledby={labelId}
          >
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onBack} className="flex-1">
          Back
        </Button>
        <Button type="submit" disabled={busy} className="flex-1">
          Verify
        </Button>
      </div>
    </form>
  );
}

function SelfieStep({
  busy,
  onCapture,
}: {
  busy: boolean;
  onCapture: (blob: Blob) => void | Promise<void>;
}) {
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <ScanFace className="h-4 w-4" aria-hidden="true" />
        Take a live selfie
      </p>
      <p className="text-xs text-muted-foreground">
        Center your face in the frame, look straight at the camera, and make sure
        you're in a well-lit area.
      </p>
      <SelfieCapture busy={busy} onCapture={onCapture} />
    </div>
  );
}

function CompletedStep({
  phone,
  selfieUrl,
  onRestart,
}: {
  phone: string | null;
  selfieUrl: string | null;
  onRestart: () => void;
}) {
  return (
    <div className="space-y-4 text-center" role="status" aria-live="polite">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
      </div>
      <div>
        <p className="font-medium">eKYC complete</p>
        <p className="text-sm text-muted-foreground">
          Your identity has been verified.
        </p>
      </div>
      {selfieUrl && (
        <img
          src={selfieUrl}
          alt="Your verified selfie"
          className="mx-auto h-28 w-28 rounded-full object-cover ring-2 ring-primary/30"
        />
      )}
      <dl className="rounded-md border bg-muted/40 p-3 text-left text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Mobile</dt>
          <dd className="font-medium">{phone}</dd>
        </div>
      </dl>
      <Button variant="outline" onClick={onRestart} className="w-full">
        Restart eKYC
      </Button>
    </div>
  );
}
