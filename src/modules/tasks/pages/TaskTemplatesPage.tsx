import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, PlusCircle, LayoutTemplate } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTaskTemplates, useCreateTaskTemplate } from "@/hooks/useTaskTemplates";
import { useTaskCategories } from "@/hooks/useTaskCategories";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";

export function TaskTemplatesPage() {
  const { user } = useAuth();
  const { data: templates, isLoading } = useTaskTemplates(user?.companyId ?? undefined);
  const { data: categories } = useTaskCategories();
  const createTemplate = useCreateTaskTemplate();

  const [templateCode, setTemplateCode] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");

  const handleCreate = async () => {
    if (!templateCode.trim() || !templateName.trim()) return;
    try {
      await createTemplate.mutateAsync({
        values: {
          templateCode: templateCode.trim().toUpperCase(),
          templateName: templateName.trim(),
          categoryId: categoryId || undefined,
          isActive: true,
        },
        companyId: user?.companyId ?? null,
        userId: user?.id,
      });
      toast({ title: "Template created", variant: "success" });
      setTemplateCode("");
      setTemplateName("");
      setCategoryId("");
    } catch (error) {
      toast({
        title: "Could not create template",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link to={ROUTES.tasks}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Task Master
        </Link>
      </Button>

      <PageHeader title="Task Templates" description="Reusable presets like Store Opening, Store Closing, Inventory Audit." />

      <Card>
        <CardHeader>
          <CardTitle>New Template</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Template Name</Label>
            <Input placeholder="e.g. Generator Check" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Template Code</Label>
            <Input placeholder="e.g. GENERATOR_CHECK" value={templateCode} onChange={(e) => setTemplateCode(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
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
          </div>
          <div className="sm:col-span-3">
            <Button onClick={handleCreate} disabled={!templateCode.trim() || !templateName.trim() || createTemplate.isPending}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Template
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          {isLoading ? (
            <LoadingState />
          ) : !templates || templates.length === 0 ? (
            <EmptyState icon={LayoutTemplate} title="No templates yet" description="Create one above." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Category</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((tpl) => (
                  <TableRow key={tpl.id}>
                    <TableCell className="font-medium">
                      {tpl.templateName}
                      {tpl.isSystemTemplate && <span className="ml-2 text-xs text-muted-foreground">System</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{tpl.templateCode}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{tpl.categoryName ?? "—"}</TableCell>
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
