import { Link } from "react-router-dom";
import { Network, Pencil, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Store } from "@/types/store";
import { formatDate } from "@/lib/utils";

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  active: "success",
  onboarding: "warning",
  inactive: "secondary",
  closed: "destructive",
};

interface StoreTableProps {
  stores: Store[];
  onDelete: (store: Store) => void;
}

export function StoreTable({ stores, onDelete }: StoreTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Store</TableHead>
          <TableHead>Code</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="w-[1%] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {stores.map((store) => (
          <TableRow key={store.id}>
            <TableCell>
              <p className="font-medium">{store.name}</p>
              {store.storeType && <p className="text-xs text-muted-foreground">{store.storeType}</p>}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{store.code}</TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {[store.city, store.state].filter(Boolean).join(", ") || "—"}
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[store.status] ?? "secondary"} className="capitalize">
                {store.status}
              </Badge>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{formatDate(store.createdAt)}</TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" asChild title="View organization">
                  <Link to={`/organization/${store.id}`}>
                    <Network className="h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" asChild title="Edit">
                  <Link to={`/stores/${store.id}/edit`}>
                    <Pencil className="h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" title="Delete" onClick={() => onDelete(store)}>
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
