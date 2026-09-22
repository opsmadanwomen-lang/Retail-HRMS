import { Link } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Company } from "@/types/company";
import { formatDate } from "@/lib/utils";

interface CompanyTableProps {
  companies: Company[];
  onDelete: (company: Company) => void;
}

export function CompanyTable({ companies, onDelete }: CompanyTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Company</TableHead>
          <TableHead>City / State</TableHead>
          <TableHead>GST Number</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="w-[1%] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {companies.map((company) => (
          <TableRow key={company.id}>
            <TableCell>
              <p className="font-medium">{company.name}</p>
              {company.email && <p className="text-xs text-muted-foreground">{company.email}</p>}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {[company.city, company.state].filter(Boolean).join(", ") || "—"}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{company.gstNumber ?? "—"}</TableCell>
            <TableCell>
              <Badge variant={company.isActive ? "success" : "secondary"}>
                {company.isActive ? "Active" : "Inactive"}
              </Badge>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{formatDate(company.createdAt)}</TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" asChild title="Edit">
                  <Link to={`/companies/${company.id}/edit`}>
                    <Pencil className="h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" title="Delete" onClick={() => onDelete(company)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
