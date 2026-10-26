// Document kinds and file rules shared by the upload component (browser) and the server.

export type DocumentOwnerType = "PARTY" | "AGREEMENT" | "UNIT" | "PAYMENT" | "EXPENSE" | "WORK_ORDER" | "STAFF_MEMBER";
export type DocumentCategoryName = "ID_DOCUMENT" | "SIGNED_AGREEMENT" | "PHOTO" | "PROOF_OF_PAYMENT" | "RECEIPT" | "SUPPLIER_INVOICE" | "OTHER";

export const CATEGORY_LABELS: Record<DocumentCategoryName, string> = {
  ID_DOCUMENT: "Identification document",
  SIGNED_AGREEMENT: "Signed agreement",
  PHOTO: "Photograph",
  PROOF_OF_PAYMENT: "Proof of payment",
  RECEIPT: "Receipt",
  SUPPLIER_INVOICE: "Supplier invoice / quote",
  OTHER: "Other supporting document",
};

/** What the file picker offers; the server checks the real contents regardless. */
export const ACCEPT_ATTRIBUTE = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
export const ACCEPTED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
