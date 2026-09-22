/**
 * Employee Code generation: STORE_CODE-XXXX-XXXX, where the random segments are
 * drawn from an alphanumeric alphabet that excludes visually ambiguous
 * characters (0/O, 1/I) — never derived from name, DOB, DOJ, or mobile number.
 *
 * Uniqueness is NOT guaranteed by this function alone (see
 * employeeService.create, which retries against the database's unique
 * constraint — the actual source of truth — on collision).
 */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomSegment(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return result;
}

export function generateEmployeeCodeCandidate(storeCode: string): string {
  const prefix = storeCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${prefix}-${randomSegment(4)}-${randomSegment(4)}`;
}
