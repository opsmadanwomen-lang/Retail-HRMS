import type { AppRole } from "./database.types";

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  companyId: string | null;
  /** Store Scope from User Management — null = All Stores. */
  storeId: string | null;
  avatarUrl: string | null;
  mustChangePassword: boolean;
}
