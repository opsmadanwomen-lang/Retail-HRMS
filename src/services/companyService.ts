import { supabase } from "@/lib/supabaseClient";
import type { CompanyRow } from "@/types/database.types";
import type { Company, CompanyFormValues } from "@/types/company";

function mapRow(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    registrationNumber: row.registration_number,
    gstNumber: row.gst_number,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    state: row.state,
    country: row.country,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const companyService = {
  async list(): Promise<Company[]> {
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []).map(mapRow);
  },

  async getById(id: string): Promise<Company | null> {
    const { data, error } = await supabase.from("companies").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapRow(data) : null;
  },

  async create(values: CompanyFormValues): Promise<Company> {
    const { data, error } = await supabase
      .from("companies")
      .insert({
        name: values.name,
        legal_name: values.legalName ?? null,
        registration_number: values.registrationNumber ?? null,
        gst_number: values.gstNumber ?? null,
        email: values.email ?? null,
        phone: values.phone ?? null,
        address: values.address ?? null,
        city: values.city ?? null,
        state: values.state ?? null,
        country: values.country ?? null,
      })
      .select("*")
      .single();

    if (error) throw error;
    return mapRow(data);
  },

  async update(id: string, values: Partial<CompanyFormValues>): Promise<Company> {
    const { data, error } = await supabase
      .from("companies")
      .update({
        name: values.name,
        legal_name: values.legalName,
        registration_number: values.registrationNumber,
        gst_number: values.gstNumber,
        email: values.email,
        phone: values.phone,
        address: values.address,
        city: values.city,
        state: values.state,
        country: values.country,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return mapRow(data);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("companies").delete().eq("id", id);
    if (error) throw error;
  },
};
