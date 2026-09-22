import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChecklistEditor } from "../components/ChecklistEditor";
import { taskFormSchema, type TaskFormSchema, TASK_PRIORITY_OPTIONS } from "../schema";
import { useCreateTask, useTask, useUpdateTask } from "@/hooks/useTasks";
import { useTaskCategories } from "@/hooks/useTaskCategories";
import { useTaskFrequencies } from "@/hooks/useTaskLookups";
import { useTaskTemplates } from "@/hooks/useTaskTemplates";
import { taskMasterService } from "@/services/taskMasterService";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";

export function TaskFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: categories } = useTaskCategories();
  const { data: frequencies } = useTaskFrequencies();
  const { data: templates } = useTaskTemplates(user?.companyId ?? undefined);
  const { data: existingTask, isLoading: isLoadingTask } = useTask(id);
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TaskFormSchema>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      priority: "medium",
      requiresVerification: true,
      allowPhotoUpload: false,
      allowDocumentUpload: false,
      allowRemarks: true,
      allowGpsPlaceholder: false,
      allowQrPlaceholder: false,
      weightage: 0,
      isActive: true,
      displayOrder: 0,
    },
  });

  useEffect(() => {
    if (existingTask) {
      reset({
        taskCode: existingTask.taskCode,
        taskName: existingTask.taskName,
        categoryId: existingTask.categoryId ?? undefined,
        frequencyId: existingTask.frequencyId ?? undefined,
        templateId: existingTask.templateId ?? undefined,
        priority: existingTask.priority,
        description: existingTask.description ?? "",
        estimatedTimeMinutes: existingTask.estimatedTimeMinutes ?? undefined,
        requiresVerification: existingTask.requiresVerification,
        allowPhotoUpload: existingTask.allowPhotoUpload,
        allowDocumentUpload: existingTask.allowDocumentUpload,
        allowRemarks: existingTask.allowRemarks,
        allowGpsPlaceholder: existingTask.allowGpsPlaceholder,
        allowQrPlaceholder: existingTask.allowQrPlaceholder,
        weightage: existingTask.weightage,
        isActive: existingTask.isActive,
        displayOrder: existingTask.displayOrder,
      });
    }
  }, [existingTask, reset]);

  const onSubmit = async (values: TaskFormSchema) => {
    try {
      const codeTaken = await taskMasterService.isCodeTaken(values.taskCode, user?.companyId ?? null, id);
      if (codeTaken) {
        setError("taskCode", { message: "This task code is already in use." });
        return;
      }

      if (isEditing && id) {
        await updateTask.mutateAsync({ id, values, userId: user?.id });
        toast({ title: "Task updated", variant: "success" });
      } else {
        const created = await createTask.mutateAsync({ values, companyId: user?.companyId ?? null, userId: user?.id });
        toast({ title: "Task created", description: "Add checklist items on the edit screen.", variant: "success" });
        navigate(`/tasks/${created.id}/edit`);
        return;
      }
      navigate(ROUTES.tasks);
    } catch (error) {
      toast({
        title: "Something went wrong",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isEditing && isLoadingTask) {
    return <p className="text-sm text-muted-foreground">Loading task…</p>;
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link to={ROUTES.tasks}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Task Master
        </Link>
      </Button>

      <PageHeader
        title={isEditing ? "Edit Task" : "New Task"}
        description="Tasks are the operational units mapped to roles and assigned to employees."
      />

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Task Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>
                Task Name <span className="text-destructive">*</span>
              </Label>
              <Input placeholder="e.g. Floor Walk" {...register("taskName")} />
              {errors.taskName && <p className="text-xs text-destructive">{errors.taskName.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>
                Task Code <span className="text-destructive">*</span>
              </Label>
              <Input placeholder="e.g. FLOOR_WALK_TASK" {...register("taskCode")} disabled={existingTask?.isSystemTask} />
              {errors.taskCode && <p className="text-xs text-destructive">{errors.taskCode.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Category</Label>
              <Controller
                name="categoryId"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {(categories ?? []).map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Frequency (Task Type)</Label>
              <Controller
                name="frequencyId"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a frequency" />
                    </SelectTrigger>
                    <SelectContent>
                      {(frequencies ?? []).map((freq) => (
                        <SelectItem key={freq.id} value={freq.id}>
                          {freq.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Template</Label>
              <Controller
                name="templateId"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      {(templates ?? []).map((tpl) => (
                        <SelectItem key={tpl.id} value={tpl.id}>
                          {tpl.templateName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Controller
                name="priority"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_PRIORITY_OPTIONS.map((p) => (
                        <SelectItem key={p} value={p} className="capitalize">
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Estimated Time (minutes)</Label>
              <Input type="number" min={0} {...register("estimatedTimeMinutes")} />
            </div>

            <div className="space-y-1.5">
              <Label>Weightage (%)</Label>
              <Input type="number" min={0} max={100} step="0.01" {...register("weightage")} />
            </div>

            <div className="space-y-1.5">
              <Label>Display Order</Label>
              <Input type="number" min={0} {...register("displayOrder")} />
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Controller
                name="isActive"
                control={control}
                render={({ field }) => (
                  <Select value={field.value ? "active" : "inactive"} onValueChange={(v) => field.onChange(v === "active")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>Description</Label>
              <Textarea placeholder="What does this task involve?" {...register("description")} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Submission Options</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Controller
              name="requiresVerification"
              control={control}
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(Boolean(c))} />
                  Requires Verification
                </label>
              )}
            />
            <Controller
              name="allowPhotoUpload"
              control={control}
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(Boolean(c))} />
                  Allow Photo Upload
                </label>
              )}
            />
            <Controller
              name="allowDocumentUpload"
              control={control}
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(Boolean(c))} />
                  Allow Document Upload
                </label>
              )}
            />
            <Controller
              name="allowRemarks"
              control={control}
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(Boolean(c))} />
                  Allow Remarks
                </label>
              )}
            />
            <Controller
              name="allowGpsPlaceholder"
              control={control}
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(Boolean(c))} />
                  Allow GPS (placeholder for future capture)
                </label>
              )}
            />
            <Controller
              name="allowQrPlaceholder"
              control={control}
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(Boolean(c))} />
                  Allow QR (placeholder for future capture)
                </label>
              )}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(ROUTES.tasks)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : "Create Task"}
          </Button>
        </div>
      </form>

      {isEditing && id && (
        <Card>
          <CardHeader>
            <CardTitle>Checklist (SOP)</CardTitle>
          </CardHeader>
          <CardContent>
            <ChecklistEditor taskId={id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
