import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useTaskChecklists } from "@/hooks/useTaskChecklist";
import { useSubmitTask } from "@/hooks/useEmployeeTask";
import { useUploadTaskAttachment } from "@/hooks/useTaskAttachments";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import type { ChecklistResponseValue, EmployeeTaskAssignment } from "@/types/task";

interface TaskSubmissionDialogProps {
  assignment: EmployeeTaskAssignment | null;
  companyId: string;
  onOpenChange: (open: boolean) => void;
}

export function TaskSubmissionDialog({ assignment, companyId, onOpenChange }: TaskSubmissionDialogProps) {
  const { user } = useAuth();
  const { data: checklists } = useTaskChecklists(assignment?.taskId);
  const submitTask = useSubmitTask();
  const uploadAttachment = useUploadTaskAttachment();

  const [responses, setResponses] = useState<Record<string, boolean>>({});
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    setResponses({});
    setRemarks("");
    setFile(null);
  }, [assignment?.id]);

  if (!assignment) return null;

  const allItems = (checklists ?? []).flatMap((c) => c.items);
  const mandatoryItemIds = allItems.filter((i) => i.isMandatory).map((i) => i.id);

  const handleSubmit = async () => {
    const checklistResponses: ChecklistResponseValue[] = allItems.map((item) => ({
      itemId: item.id,
      checked: Boolean(responses[item.id]),
    }));

    try {
      const submission = await submitTask.mutateAsync({
        assignment,
        mandatoryItemIds,
        values: { remarks: remarks || undefined, checklistResponses },
        submittedBy: user?.id,
      });

      if (file) {
        await uploadAttachment.mutateAsync({
          companyId,
          assignmentId: assignment.id,
          submissionId: submission.id,
          attachmentType: file.type.startsWith("image/") ? "photo" : "document",
          file,
          uploadedBy: user?.id,
        });
      }

      toast({ title: "Task submitted", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not submit task",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={Boolean(assignment)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Complete — {assignment.taskName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {allItems.length > 0 && (
            <div className="space-y-2">
              <Label>Checklist</Label>
              <div className="space-y-2 rounded-lg border p-3">
                {allItems.map((item) => (
                  <label key={item.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={Boolean(responses[item.id])}
                      onCheckedChange={(checked) => setResponses((prev) => ({ ...prev, [item.id]: Boolean(checked) }))}
                    />
                    <span>
                      {item.itemName}
                      {item.isMandatory && <span className="ml-1 text-destructive">*</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {assignment.allowRemarks !== false && (
            <div className="space-y-1.5">
              <Label>Remarks</Label>
              <Textarea
                placeholder="Add any notes about this completion…"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          )}

          {(assignment.allowPhotoUpload || assignment.allowDocumentUpload) && (
            <div className="space-y-1.5">
              <Label>Attachment</Label>
              <input
                type="file"
                accept={assignment.allowPhotoUpload ? "image/*" : undefined}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitTask.isPending || uploadAttachment.isPending}>
            {submitTask.isPending || uploadAttachment.isPending ? "Submitting…" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
