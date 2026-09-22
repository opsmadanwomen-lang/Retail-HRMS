import { Outlet } from "react-router-dom";

export function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
            RH
          </div>
          <h1 className="text-xl font-semibold">Retail HRMS</h1>
          <p className="text-sm text-muted-foreground">Enterprise Store Management & HRMS</p>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
