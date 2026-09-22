import type { EmployeeDocumentType } from "@/types/database.types";

export const REQUIRED_DOCUMENT_TYPES: EmployeeDocumentType[] = [
  "photo",
  "aadhaar",
  "pan",
  "address_proof",
  "resume",
];

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  photo: "Photograph",
  aadhaar: "Aadhaar",
  pan: "PAN",
  address_proof: "Address Proof",
  resume: "Resume",
  joining_letter: "Joining Form",
  appointment_letter: "Appointment Letter",
  certificate: "Certificate",
  other: "Other",
};
