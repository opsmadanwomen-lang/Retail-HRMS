import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";
import { Loader2 } from "lucide-react";

const PASSWORD_RULE_MESSAGE = "Password must contain at least 8 characters, including a number and special character.";
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().regex(PASSWORD_REGEX, PASSWORD_RULE_MESSAGE),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

/**
 * Shown instead of the dashboard whenever the logged-in account has must_change_password = true
 * (a freshly created Staff account, or one an Admin/HR just reset) — see ProtectedRoute, which
 * redirects here regardless of which URL was requested.
 */
export function ChangePasswordPage() {
  const { user, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChangePasswordValues>({ resolver: zodResolver(changePasswordSchema) });

  const onSubmit = async (values: ChangePasswordValues) => {
    if (!user) return;
    setIsSubmitting(true);
    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: values.currentPassword,
      });
      if (verifyError) {
        toast({ title: "Incorrect current password", description: "Please try again.", variant: "destructive" });
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: values.newPassword });
      if (updateError) throw updateError;

      const { error: profileError } = await supabase
        .from("profiles")
        .update({ must_change_password: false })
        .eq("id", user.id);
      if (profileError) throw profileError;

      await refreshProfile();
      toast({ title: "Password updated", description: "You can now use your new password.", variant: "success" });
      navigate(ROUTES.dashboard, { replace: true });
    } catch (error) {
      toast({
        title: "Could not update password",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
            RH
          </div>
          <h1 className="text-xl font-semibold">Retail HRMS</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
            <CardDescription>
              For security, you must set a new password before continuing to your dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="currentPassword">Current / Temporary Password</Label>
                <Input id="currentPassword" type="password" {...register("currentPassword")} />
                {errors.currentPassword && <p className="text-xs text-destructive">{errors.currentPassword.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="newPassword">New Password</Label>
                <Input id="newPassword" type="password" {...register("newPassword")} />
                {errors.newPassword ? (
                  <p className="text-xs text-destructive">{errors.newPassword.message}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{PASSWORD_RULE_MESSAGE}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input id="confirmPassword" type="password" {...register("confirmPassword")} />
                {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isSubmitting ? "Saving…" : "Save New Password"}
              </Button>

              <Button type="button" variant="ghost" className="w-full" onClick={() => signOut()}>
                Sign out instead
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
