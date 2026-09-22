import { OrganizationTreeNode } from "./OrganizationTreeNode";
import type { OrganizationTeamNode } from "@/types/organization";

interface OrganizationTreeProps {
  storeName: string;
  teams: OrganizationTeamNode[];
}

export function OrganizationTree({ storeName, teams }: OrganizationTreeProps) {
  return (
    <div className="rounded-lg border p-2">
      <OrganizationTreeNode label={storeName} depth={0} defaultOpen>
        {teams.map((team) => (
          <OrganizationTreeNode key={team.id} label={team.name} badge={team.category} depth={1} defaultOpen>
            {team.departments.map((department) => (
              <OrganizationTreeNode key={department.id} label={department.name} depth={2}>
                {department.designations.map((designation) => (
                  <OrganizationTreeNode
                    key={designation.id}
                    label={designation.title}
                    count={designation.employee_count}
                    depth={3}
                  />
                ))}
              </OrganizationTreeNode>
            ))}
          </OrganizationTreeNode>
        ))}
      </OrganizationTreeNode>
    </div>
  );
}
