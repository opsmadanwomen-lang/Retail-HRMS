import { Copy, Printer } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import type { StaffAccountCredentials } from "@/services/staffAccountService";

interface StaffAccountCredentialsDialogProps {
  credentials: StaffAccountCredentials | null;
  onClose: () => void;
}

/** One-time display of a newly (re)generated Staff login — never shown again after this closes. */
export function StaffAccountCredentialsDialog({ credentials, onClose }: StaffAccountCredentialsDialogProps) {
  if (!credentials) return null;

  const appUrl = typeof window !== "undefined" ? window.location.origin : "";

  const credentialsText = [
    `App URL: ${appUrl}`,
    `Employee Name: ${credentials.employeeName}`,
    `Employee Code: ${credentials.employeeCode}`,
    `Login ID: ${credentials.loginId}`,
    `Temporary Password: ${credentials.tempPassword}`,
  ].join("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(credentialsText);
      toast({ title: "Copied", description: "Credentials copied to clipboard.", variant: "success" });
    } catch {
      toast({ title: "Could not copy", description: "Please copy the credentials manually.", variant: "destructive" });
    }
  };

  const handlePrint = () => {
    const printWindow = window.open("", "_blank", "width=480,height=400");
    if (!printWindow) return;
    printWindow.document.write(
      `<pre style="font-family: monospace; font-size: 14px; white-space: pre-wrap;">${credentialsText}</pre>`
    );
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <Dialog open={Boolean(credentials)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Staff Account Created Successfully</DialogTitle>
          <DialogDescription>
            This password is shown only once. The employee will be required to change it on first login.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
          {appUrl ? (
            <div>
              <p className="text-xs text-muted-foreground">App URL</p>
              <p className="break-all font-mono font-medium">{appUrl}</p>
            </div>
          ) : null}
          <div>
            <p className="text-xs text-muted-foreground">Employee Name</p>
            <p className="font-medium">{credentials.employeeName}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Employee Code</p>
            <p className="font-mono font-medium">{credentials.employeeCode}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Login ID</p>
            <p className="font-mono font-medium">{credentials.loginId}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Temporary Password</p>
            <p className="font-mono font-medium">{credentials.tempPassword}</p>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={handleCopy} className="flex-1">
            <Copy className="mr-2 h-4 w-4" />
            Copy Credentials
          </Button>
          <Button variant="outline" onClick={handlePrint} className="flex-1">
            <Printer className="mr-2 h-4 w-4" />
            Print / Download
          </Button>
          <Button onClick={onClose} className="flex-1">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
