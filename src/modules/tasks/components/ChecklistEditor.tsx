import { useState } from "react";
import { PlusCircle, Trash2, GripVertical } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useAddChecklistItem,
  useCreateTaskChecklist,
  useRemoveChecklistItem,
  useRemoveTaskChecklist,
  useTaskChecklists,
} from "@/hooks/useTaskChecklist";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";

interface ChecklistEditorProps {
  taskId: string;
}

export function ChecklistEditor({ taskId }: ChecklistEditorProps) {
  const { user } = useAuth();
  const { data: checklists, isLoading } = useTaskChecklists(taskId);
  const createChecklist = useCreateTaskChecklist();
  const removeChecklist = useRemoveTaskChecklist();
  const addItem = useAddChecklistItem();
  const removeItem = useRemoveChecklistItem();

  const [newChecklistName, setNewChecklistName] = useState("");
  const [newItemNames, setNewItemNames] = useState<Record<string, string>>({});

  const handleCreateChecklist = async () => {
    if (!newChecklistName.trim()) return;
    try {
      await createChecklist.mutateAsync({ taskId, values: { name: newChecklistName.trim() }, userId: user?.id });
      setNewChecklistName("");
    } catch (error) {
      toast({
        title: "Could not create checklist",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleAddItem = async (checklistId: string) => {
    const name = newItemNames[checklistId]?.trim();
    if (!name) return;
    try {
      await addItem.mutateAsync({ checklistId, taskId, values: { itemName: name, isMandatory: true }, userId: user?.id });
      setNewItemNames((prev) => ({ ...prev, [checklistId]: "" }));
    } catch (error) {
      toast({
        title: "Could not add item",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading checklist…</p>;

  return (
    <div className="space-y-4">
      {(checklists ?? []).map((checklist) => (
        <Card key={checklist.id}>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">{checklist.name}</p>
              <Button
                variant="ghost"
                size="icon"
                title="Remove checklist"
                onClick={() => removeChecklist.mutate({ checklistId: checklist.id, taskId })}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>

            <div className="space-y-2">
              {checklist.items.map((item) => (
                <div key={item.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1">{item.itemName}</span>
                  {item.isMandatory && <span className="text-xs text-muted-foreground">Mandatory</span>}
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Remove item"
                    onClick={() => removeItem.mutate({ itemId: item.id, taskId })}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
              {checklist.items.length === 0 && (
                <p className="text-xs text-muted-foreground">No items yet — add the first one below.</p>
              )}
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="e.g. Lights ON"
                value={newItemNames[checklist.id] ?? ""}
                onChange={(e) => setNewItemNames((prev) => ({ ...prev, [checklist.id]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && handleAddItem(checklist.id)}
              />
              <Button variant="outline" onClick={() => handleAddItem(checklist.id)} disabled={addItem.isPending}>
                Add Item
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label>New Checklist</Label>
            <Input
              placeholder="e.g. Store Opening Checklist"
              value={newChecklistName}
              onChange={(e) => setNewChecklistName(e.target.value)}
            />
          </div>
          <Button onClick={handleCreateChecklist} disabled={!newChecklistName.trim() || createChecklist.isPending}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Checklist
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
