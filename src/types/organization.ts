export interface OrganizationDesignationNode {
  id: string;
  title: string;
  employee_count: number;
}

export interface OrganizationDepartmentNode {
  id: string;
  name: string;
  designations: OrganizationDesignationNode[];
}

export interface OrganizationTeamNode {
  id: string;
  name: string;
  category: "frontend" | "backend";
  departments: OrganizationDepartmentNode[];
}
