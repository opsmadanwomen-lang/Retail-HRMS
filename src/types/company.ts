export interface Company {
  id: string;
  name: string;
  legalName: string | null;
  registrationNumber: string | null;
  gstNumber: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyFormValues {
  name: string;
  legalName?: string;
  registrationNumber?: string;
  gstNumber?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
}
