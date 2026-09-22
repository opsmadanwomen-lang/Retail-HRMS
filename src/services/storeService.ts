import { supabase } from "@/lib/supabaseClient";
import type { StoreRow } from "@/types/database.types";
import type { Store, StoreFormValues } from "@/types/store";

function mapRow(row: StoreRow): Store {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    code: row.code,
    storeType: row.store_type,
    address: row.address,
    city: row.city,
    state: row.state,
    country: row.country,
    gstNumber: row.gst_number,
    phone: row.phone,
    email: row.email,
    status: row.status,
    provisionedAt: row.provisioned_at,
    createdAt: row.created_at,
  };
}

export const storeService = {
  async list(companyId?: string): Promise<Store[]> {
    let query = supabase.from("stores").select("*").order("created_at", { ascending: false });
    if (companyId) query = query.eq("company_id", companyId);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(mapRow);
  },

  async getById(id: string): Promise<Store | null> {
    const { data, error } = await supabase.from("stores").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapRow(data) : null;
  },

  /**
   * Creates a store. The `trg_stores_auto_provision` database trigger
   * (see supabase/migrations/0003) copies the entire Master Organization
   * Template into store_teams / store_departments / store_designations
   * automatically — no client-side provisioning logic is required.
   */
  async create(companyId: string, values: StoreFormValues): Promise<Store> {
    const { data, error } = await supabase
      .from("stores")
      .insert({
        company_id: companyId,
        name: values.name,
        code: values.code,
        store_type: values.storeType ?? null,
        address: values.address ?? null,
        city: values.city ?? null,
        state: values.state ?? null,
        country: values.country ?? null,
        gst_number: values.gstNumber ?? null,
        phone: values.phone ?? null,
        email: values.email ?? null,
        status: values.status,
      })
      .select("*")
      .single();

    if (error) throw error;
    return mapRow(data);
  },

  async update(id: string, values: Partial<StoreFormValues>): Promise<Store> {
    const { data, error } = await supabase
      .from("stores")
      .update({
        name: values.name,
        code: values.code,
        store_type: values.storeType,
        address: values.address,
        city: values.city,
        state: values.state,
        country: values.country,
        gst_number: values.gstNumber,
        phone: values.phone,
        email: values.email,
        status: values.status,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return mapRow(data);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("stores").delete().eq("id", id);
    if (error) throw error;
  },

  async isCodeTaken(companyId: string, code: string, excludeId?: string): Promise<boolean> {
    let query = supabase
      .from("stores")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("code", code);

    if (excludeId) query = query.neq("id", excludeId);

    const { count, error } = await query;
    if (error) throw error;
    return (count ?? 0) > 0;
  },
};
