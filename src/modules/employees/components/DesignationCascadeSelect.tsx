import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOrganizationTree } from "@/hooks/useOrganizationTree";

interface DesignationCascadeSelectProps {
  storeId?: string;
  value?: string;
  onChange: (storeDesignationId: string) => void;
  disabled?: boolean;
}

/**
 * A single grouped select of every Designation available in the chosen
 * Store's organization structure, labeled "Team / Department / Designation"
 * so the full hierarchy is visible while keeping the form to one field.
 * Options come entirely from the store's already-provisioned org tree —
 * nothing here is hardcoded.
 */
export function DesignationCascadeSelect({ storeId, value, onChange, disabled }: DesignationCascadeSelectProps) {
  const { data: tree, isLoading } = useOrganizationTree(storeId);

  const options = (tree ?? []).flatMap((team) =>
    team.departments.flatMap((department) =>
      department.designations.map((designation) => ({
        id: designation.id,
        label: `${team.name} / ${department.name} / ${designation.title}`,
      }))
    )
  );

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled || !storeId || isLoading}>
      <SelectTrigger>
        <SelectValue placeholder={!storeId ? "Select a store first" : isLoading ? "Loading…" : "Select a designation"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
