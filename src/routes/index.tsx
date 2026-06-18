import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { CheckCircle2, LogOut, Phone, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { supabase } from "@/integrations/supabase/client";
import { generateOtp, isValidPhone } from "@/lib/phone";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Phone Verification Demo" },
      { name: "description", content: "Sign in with Google and verify your mobile number via OTP." },
    ],
  }),
  component: Index,
});

type Profile = { phone: string | null; phone_verified: boolean };
type Step = "loading" | "phone" | "otp" | "verified";

const EMPTY_PROFILE: Profile = { phone: null, phone_verified: false };

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
        .select("phone, phone_verified")
        .eq("id", data.user.id)
        .maybeSingle();
      if (cancelled) return;
      const prof = (p as Profile | null) ?? EMPTY_PROFILE;
      setProfile(prof);
      setPhone(prof.phone ?? "");
      setStep(prof.phone_verified ? "verified" : "phone");
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
    setProfile({ phone: trimmed, phone_verified: true });
    setStep("verified");
    toast.success("Phone number verified");
  }, [otp, phone, user]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }, [navigate]);

  const reset = useCallback(async () => {
    if (!user) return;
    await supabase.from("profiles").update({ phone_verified: false }).eq("id", user.id);
    setProfile((p) => ({ ...p, phone_verified: false }));
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

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate text-xl">Hi, {displayName}</CardTitle>
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
          {step === "verified" && (
            <VerifiedStep phone={profile.phone} onChange={reset} />
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

function VerifiedStep({ phone, onChange }: { phone: string | null; onChange: () => void }) {
  return (
    <div className="space-y-4 text-center" role="status" aria-live="polite">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
      </div>
      <div>
        <p className="font-medium">Phone verified</p>
        <p className="text-sm text-muted-foreground">{phone}</p>
      </div>
      <Button variant="outline" onClick={onChange} className="w-full">
        Change number
      </Button>
    </div>
  );
}
