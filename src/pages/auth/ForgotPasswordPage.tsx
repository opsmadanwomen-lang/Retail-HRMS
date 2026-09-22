import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";
import { Loader2 } from "lucide-react";

/**
 * Admin/company logins use a real email, so Supabase's standard email-based reset works directly.
 * Staff logins use a synthetic, non-deliverable email (see lib/staffLogin.ts) — there is no inbox
 * to send a reset link to, so for an Employee Code we route the Staff member to ask their
 * Store Manager/HR/Admin for a reset instead of pretending to send an email that will never
 * arrive. That admin-issued reset is the real, working flow (see Employee Profile → Reset Password).
 */
export function ForgotPasswordPage() {
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [staffNotice, setStaffNotice] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    if (!trimmed.includes("@")) {
      setStaffNotice(true);
      setSent(false);
      return;
    }

    setStaffNotice(false);
    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed);
      if (error) throw error;
      setSent(true);
    } catch (error) {
      toast({
        title: "Could not send reset email",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forgot Password</CardTitle>
        <CardDescription>Enter your Login ID or email to reset your password.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sent ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            If an account exists for that email, a password reset link has been sent.
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="loginId">Login ID / Email</Label>
              <Input
                id="loginId"
                placeholder="MW-X7M4-K29V or you@company.com"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </div>

            {staffNotice ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Staff passwords can't be reset by email. Please ask your Store Manager, HR, or Admin to reset your
                password from your Employee Profile — they'll give you a new temporary password.
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSubmitting ? "Sending…" : "Send Reset Link"}
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <Link to={ROUTES.login} className="underline underline-offset-4 hover:text-foreground">
            Back to Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
