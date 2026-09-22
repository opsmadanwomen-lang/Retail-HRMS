import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChecklistEditor } from "../components/ChecklistEditor";
import { useTasks } from "@/hooks/useTasks";
import { useAuth } from "@/hooks/useAuth";

export function ChecklistsPage() {
  const { user } = useAuth();
  const [taskId, setTaskId] = useState("");
  const { data: tasks } = useTasks({ companyId: user?.companyId ?? undefined, isActive: true });

  return (
    <div className="space-y-6">
      <PageHeader title="Checklist" description="Every task's SOP — unlimited checklist items, mandatory or optional." />

      <Card>
        <CardHeader>
          <CardTitle>Select Task</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={taskId} onValueChange={setTaskId}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Choose a task" />
            </SelectTrigger>
            <SelectContent>
              {(tasks ?? []).map((task) => (
                <SelectItem key={task.id} value={task.id}>
                  {task.taskName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {taskId && <ChecklistEditor taskId={taskId} />}
    </div>
  );
}
