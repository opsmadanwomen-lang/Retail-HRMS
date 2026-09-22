import type { StoreStatus } from "./database.types";

export interface Store {
  id: string;
  companyId: string;
  name: string;
  code: string;
  storeType: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  gstNumber: string | null;
  phone: string | null;
  email: string | null;
  status: StoreStatus;
  provisionedAt: string | null;
  createdAt: string;
}

export interface StoreFormValues {
  name: string;
  code: string;
  storeType?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  gstNumber?: string;
  phone?: string;
  email?: string;
  status: StoreStatus;
}
