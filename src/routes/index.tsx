import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { CheckCircle2, LogOut, Phone, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { supabase } from "@/integrations/supabase/client";

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

function Index() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [step, setStep] = useState<Step>("loading");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [expectedOtp, setExpectedOtp] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
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
      const prof = (p as Profile | null) ?? { phone: null, phone_verified: false };
      setProfile(prof);
      if (prof.phone_verified) {
        setStep("verified");
        setPhone(prof.phone ?? "");
      } else {
        setStep("phone");
        if (prof.phone) setPhone(prof.phone);
      }
    })();
  }, [navigate]);

  const sendOtp = async () => {
    if (!/^\+?[1-9]\d{7,14}$/.test(phone.trim())) {
      toast.error("Enter a valid phone number (8–15 digits, optional +)");
      return;
    }
    setBusy(true);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setExpectedOtp(code);
    setOtp("");
    setStep("otp");
    setBusy(false);
    toast.success(`Demo OTP: ${code}`, {
      description: "In a real app this would be sent via SMS.",
      duration: 15000,
    });
  };

  const verifyOtp = async () => {
    if (otp.length !== 6) {
      toast.error("Enter the 6-digit code");
      return;
    }
    if (otp !== expectedOtp) {
      toast.error("Incorrect code, try again");
      return;
    }
    if (!user) return;
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ phone: phone.trim(), phone_verified: true, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setProfile({ phone: phone.trim(), phone_verified: true });
    setStep("verified");
    toast.success("Phone number verified");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const reset = async () => {
    if (!user) return;
    await supabase.from("profiles").update({ phone_verified: false }).eq("id", user.id);
    setProfile({ phone: profile?.phone ?? null, phone_verified: false });
    setOtp("");
    setExpectedOtp("");
    setStep("phone");
  };

  if (step === "loading") {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">Hi, {user?.user_metadata?.full_name ?? user?.email}</CardTitle>
              <CardDescription className="break-all">{user?.email}</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "phone" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="phone" className="flex items-center gap-2">
                  <Phone className="h-4 w-4" /> Mobile number
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+15551234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                />
              </div>
              <Button onClick={sendOtp} disabled={busy} className="w-full">Send OTP</Button>
            </>
          )}
          {step === "otp" && (
            <>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" /> Enter the 6-digit code sent to {phone}
                </Label>
                <div className="flex justify-center pt-2">
                  <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                    <InputOTPGroup>
                      {[0,1,2,3,4,5].map((i) => <InputOTPSlot key={i} index={i} />)}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep("phone")} className="flex-1">Back</Button>
                <Button onClick={verifyOtp} disabled={busy} className="flex-1">Verify</Button>
              </div>
            </>
          )}
          {step === "verified" && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-600">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <div>
                <p className="font-medium">Phone verified</p>
                <p className="text-sm text-muted-foreground">{profile?.phone}</p>
              </div>
              <Button variant="outline" onClick={reset} className="w-full">Change number</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
