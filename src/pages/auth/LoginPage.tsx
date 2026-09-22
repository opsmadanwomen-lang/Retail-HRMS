import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";
import { resolveLoginEmail } from "@/lib/staffLogin";
import { Loader2 } from "lucide-react";

const loginSchema = z.object({
  loginId: z.string().min(1, "Login ID is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { signIn, user } = useAuth();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // An already-authenticated session visiting /login directly (e.g. a stale bookmark, or
  // browser back button after signing in) should land on the dashboard, not the login form.
  if (user) {
    return <Navigate to={ROUTES.dashboard} replace />;
  }

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (values: LoginValues) => {
    setIsSubmitting(true);
    try {
      await signIn(resolveLoginEmail(values.loginId), values.password);
      toast({ title: "Welcome back", description: "Signed in successfully.", variant: "success" });
      navigate(ROUTES.dashboard, { replace: true });
    } catch (error) {
      toast({
        title: "Sign in failed",
        description: error instanceof Error ? error.message : "Please check your credentials and try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Use your company admin email or your Employee Login ID.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="loginId">Employee Login ID / Email</Label>
            <Input id="loginId" placeholder="MW-X7M4-K29V or you@company.com" {...register("loginId")} />
            {errors.loginId && <p className="text-xs text-destructive">{errors.loginId.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" placeholder="••••••••" {...register("password")} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isSubmitting ? "Signing in…" : "Login"}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            <Link to={ROUTES.forgotPassword} className="underline underline-offset-4 hover:text-foreground">
              Forgot Password?
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
