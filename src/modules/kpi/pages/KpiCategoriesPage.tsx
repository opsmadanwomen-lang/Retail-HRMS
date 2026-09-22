import { useState } from "react";
import { PlusCircle, Tags } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useAllKpiCategories, useCreateKpiCategory, useSetKpiCategoryActive } from "@/hooks/useKpiCategories";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";

export function KpiCategoriesPage() {
  const { user } = useAuth();
  const { data: categories, isLoading } = useAllKpiCategories();
  const createCategory = useCreateKpiCategory();
  const setActive = useSetKpiCategoryActive();
  const [name, setName] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      await createCategory.mutateAsync({
        name: name.trim(),
        displayOrder: (categories?.length ?? 0) + 1,
        userId: user?.id,
      });
      toast({ title: "Category created", variant: "success" });
      setName("");
    } catch (error) {
      toast({
        title: "Could not create category",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="KPI Categories"
        description="The database-driven category list every KPI is grouped under."
      />

      <Card>
        <CardContent className="flex flex-col gap-3 p-6 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label>New Category</Label>
            <Input placeholder="e.g. Loss Prevention" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button onClick={handleCreate} disabled={!name.trim() || createCategory.isPending}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Category
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          {isLoading ? (
            <LoadingState />
          ) : !categories || categories.length === 0 ? (
            <EmptyState icon={Tags} title="No categories yet" description="Add your first KPI category above." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Display Order</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((cat) => (
                  <TableRow key={cat.id}>
                    <TableCell className="font-medium">{cat.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{cat.displayOrder}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={cat.isActive ? "success" : "secondary"}>
                          {cat.isActive ? "Active" : "Inactive"}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setActive.mutate({ id: cat.id, isActive: !cat.isActive, userId: user?.id })}
                          disabled={setActive.isPending}
                        >
                          {cat.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
