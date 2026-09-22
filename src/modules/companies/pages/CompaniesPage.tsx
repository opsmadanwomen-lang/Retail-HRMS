import { useState } from "react";
import { Link } from "react-router-dom";
import { Building2, PlusCircle } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CompanyTable } from "../components/CompanyTable";
import { useCompanies, useDeleteCompany } from "@/hooks/useCompanies";
import { toast } from "@/components/ui/use-toast";
import type { Company } from "@/types/company";

export function CompaniesPage() {
  const { data: companies, isLoading } = useCompanies();
  const deleteCompany = useDeleteCompany();
  const [companyToDelete, setCompanyToDelete] = useState<Company | null>(null);

  const handleDelete = async () => {
    if (!companyToDelete) return;
    try {
      await deleteCompany.mutateAsync(companyToDelete.id);
      toast({ title: "Company deleted", description: `${companyToDelete.name} was removed.`, variant: "success" });
      setCompanyToDelete(null);
    } catch (error) {
      toast({
        title: "Could not delete company",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Companies"
        description="Manage every company on the platform."
        actions={
          <Button asChild>
            <Link to="/companies/new">
              <PlusCircle className="mr-2 h-4 w-4" />
              New Company
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-6">
          {isLoading ? (
            <LoadingState />
          ) : !companies || companies.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No companies yet"
              description="Create your first company to start onboarding stores."
              action={
                <Button asChild size="sm">
                  <Link to="/companies/new">Create a company</Link>
                </Button>
              }
            />
          ) : (
            <CompanyTable companies={companies} onDelete={setCompanyToDelete} />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(companyToDelete)}
        onOpenChange={(open) => !open && setCompanyToDelete(null)}
        title="Delete this company?"
        description={`This will permanently remove "${companyToDelete?.name}" and cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        isLoading={deleteCompany.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
