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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RolePerformanceMetrics } from "@/modules/performance-data/components/RolePerformanceMetrics";
import { roleFormSchema, type RoleFormSchema, ROLE_TYPE_OPTIONS } from "../schema";
import { useCreateRole, useRole, useUpdateRole } from "@/hooks/useRoles";
import { useRoleCategories } from "@/hooks/useRoleLookups";
import { useMasterDepartments } from "@/hooks/useMasterDepartments";
import { roleService } from "@/services/roleService";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";

export function RoleFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: categories } = useRoleCategories();
  const { data: departments } = useMasterDepartments();
  const { data: existingRole, isLoading: isLoadingRole } = useRole(id);
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RoleFormSchema>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: { roleType: "both", isActive: true, displayOrder: 0 },
  });

  useEffect(() => {
    if (existingRole) {
      reset({
        roleName: existingRole.roleName,
        roleCode: existingRole.roleCode,
        categoryId: existingRole.categoryId ?? undefined,
        description: existingRole.description ?? "",
        roleType: existingRole.roleType,
        departmentId: existingRole.departmentId ?? undefined,
        isActive: existingRole.isActive,
        displayOrder: existingRole.displayOrder,
      });
    }
  }, [existingRole, reset]);

  const onSubmit = async (values: RoleFormSchema) => {
    try {
      const codeTaken = await roleService.isCodeTaken(values.roleCode, user?.companyId ?? null, id);
      if (codeTaken) {
        setError("roleCode", { message: "This role code is already in use." });
        return;
      }

      if (isEditing && id) {
        await updateRole.mutateAsync({ id, values, userId: user?.id });
        toast({ title: "Role updated", variant: "success" });
      } else {
        await createRole.mutateAsync({ values, companyId: user?.companyId ?? null, userId: user?.id });
        toast({ title: "Role created", variant: "success" });
      }
      navigate(ROUTES.roles);
    } catch (error) {
      toast({
        title: "Something went wrong",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isEditing && isLoadingRole) {
    return <p className="text-sm text-muted-foreground">Loading role…</p>;
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link to={ROUTES.roles}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Roles
        </Link>
      </Button>

      <PageHeader
        title={isEditing ? "Edit Role" : "New Role"}
        description="Roles are additional responsibilities employees can hold alongside their primary designation."
      />

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        <Card>
          <CardContent className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>
                Role Name <span className="text-destructive">*</span>
              </Label>
              <Input placeholder="e.g. Fire Safety Incharge" {...register("roleName")} />
              {errors.roleName && <p className="text-xs text-destructive">{errors.roleName.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>
                Role Code <span className="text-destructive">*</span>
              </Label>
              <Input placeholder="e.g. FIRE_SAFETY_INCHARGE" {...register("roleCode")} disabled={existingRole?.isSystemRole} />
              {errors.roleCode && <p className="text-xs text-destructive">{errors.roleCode.message}</p>}
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
              <Label>Department</Label>
              <Controller
                name="departmentId"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Applies store-wide (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {(departments ?? []).map((dept) => (
                        <SelectItem key={dept.id} value={dept.id}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                Role Type <span className="text-destructive">*</span>
              </Label>
              <Controller
                name="roleType"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_TYPE_OPTIONS.map((type) => (
                        <SelectItem key={type} value={type} className="capitalize">
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
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
              <Textarea placeholder="What does this role involve?" {...register("description")} />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(ROUTES.roles)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : "Create Role"}
          </Button>
        </div>
      </form>

      {isEditing && id && (
        <Card>
          <CardHeader>
            <CardTitle>Performance Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <RolePerformanceMetrics roleId={id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
