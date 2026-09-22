import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ListChecks, PlusCircle } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TaskTable } from "../components/TaskTable";
import { TaskFilters } from "../components/TaskFilters";
import { TaskSearchBar } from "../components/TaskSearchBar";
import { useDeleteTask, useTasks } from "@/hooks/useTasks";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";
import type { Task, TaskFilters as TaskFiltersValue } from "@/types/task";

export function TaskMasterPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<TaskFiltersValue>({});
  const [search, setSearch] = useState("");
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);

  const effectiveFilters = useMemo<TaskFiltersValue>(
    () => ({ ...filters, companyId: user?.companyId ?? undefined, search: search || undefined }),
    [filters, search, user?.companyId]
  );

  const { data: tasks, isLoading } = useTasks(effectiveFilters);
  const deleteTask = useDeleteTask();

  const handleDelete = async () => {
    if (!taskToDelete) return;
    try {
      await deleteTask.mutateAsync(taskToDelete.id);
      toast({ title: "Task deleted", description: `${taskToDelete.taskName} was removed.`, variant: "success" });
      setTaskToDelete(null);
    } catch (error) {
      toast({
        title: "Could not delete task",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Task Master"
        description="Every task available to map onto roles and assign to employees."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to={ROUTES.roleTask}>Role Mapping</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={ROUTES.taskTemplates}>Templates</Link>
            </Button>
            <Button asChild>
              <Link to={ROUTES.taskNew}>
                <PlusCircle className="mr-2 h-4 w-4" />
                New Task
              </Link>
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="space-y-4 p-6">
          <TaskSearchBar value={search} onChange={setSearch} />
          <TaskFilters value={filters} onChange={setFilters} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          {isLoading ? (
            <LoadingState />
          ) : !tasks || tasks.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No tasks found"
              description="Create a custom task, or adjust your filters."
              action={
                <Button asChild size="sm">
                  <Link to={ROUTES.taskNew}>Create a task</Link>
                </Button>
              }
            />
          ) : (
            <TaskTable tasks={tasks} onEdit={(task) => navigate(`/tasks/${task.id}/edit`)} onDelete={setTaskToDelete} />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(taskToDelete)}
        onOpenChange={(open) => !open && setTaskToDelete(null)}
        title="Delete this task?"
        description={`This will permanently remove "${taskToDelete?.taskName}". Existing assignment history is preserved.`}
        confirmLabel="Delete"
        variant="destructive"
        isLoading={deleteTask.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
