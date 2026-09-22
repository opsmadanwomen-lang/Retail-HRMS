import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { companyFormSchema, type CompanyFormSchema } from "../schema";
import { useCompany, useCreateCompany, useUpdateCompany } from "@/hooks/useCompanies";
import { toast } from "@/components/ui/use-toast";
import { ROUTES } from "@/constants/routes";

const FIELDS: Array<{ name: keyof CompanyFormSchema; label: string; required?: boolean; span?: 1 | 2 }> = [
  { name: "name", label: "Company Name", required: true, span: 2 },
  { name: "legalName", label: "Legal Name", span: 2 },
  { name: "registrationNumber", label: "Registration Number" },
  { name: "gstNumber", label: "GST Number" },
  { name: "email", label: "Email" },
  { name: "phone", label: "Phone" },
  { name: "address", label: "Address", span: 2 },
  { name: "city", label: "City" },
  { name: "state", label: "State" },
  { name: "country", label: "Country" },
];

export function CompanyFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();

  const { data: existingCompany, isLoading: isLoadingCompany } = useCompany(id);
  const createCompany = useCreateCompany();
  const updateCompany = useUpdateCompany();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CompanyFormSchema>({ resolver: zodResolver(companyFormSchema) });

  useEffect(() => {
    if (existingCompany) {
      reset({
        name: existingCompany.name,
        legalName: existingCompany.legalName ?? "",
        registrationNumber: existingCompany.registrationNumber ?? "",
        gstNumber: existingCompany.gstNumber ?? "",
        email: existingCompany.email ?? "",
        phone: existingCompany.phone ?? "",
        address: existingCompany.address ?? "",
        city: existingCompany.city ?? "",
        state: existingCompany.state ?? "",
        country: existingCompany.country ?? "",
      });
    }
  }, [existingCompany, reset]);

  const onSubmit = async (values: CompanyFormSchema) => {
    try {
      if (isEditing && id) {
        await updateCompany.mutateAsync({ id, values });
        toast({ title: "Company updated", variant: "success" });
      } else {
        await createCompany.mutateAsync(values);
        toast({ title: "Company created", variant: "success" });
      }
      navigate(ROUTES.companies);
    } catch (error) {
      toast({
        title: "Something went wrong",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isEditing && isLoadingCompany) {
    return <p className="text-sm text-muted-foreground">Loading company…</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEditing ? "Edit Company" : "New Company"}
        description="Companies are the top-level tenant in the platform. Every store belongs to a company."
      />

      <Card>
        <CardContent className="p-6">
          <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={handleSubmit(onSubmit)} noValidate>
            {FIELDS.map((field) => (
              <div key={field.name} className={`space-y-1.5 ${field.span === 2 ? "sm:col-span-2" : ""}`}>
                <Label htmlFor={field.name}>
                  {field.label}
                  {field.required && <span className="text-destructive"> *</span>}
                </Label>
                <Input id={field.name} {...register(field.name)} />
                {errors[field.name] && (
                  <p className="text-xs text-destructive">{errors[field.name]?.message as string}</p>
                )}
              </div>
            ))}

            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => navigate(ROUTES.companies)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? "Save changes" : "Create company"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
