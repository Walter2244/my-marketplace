import type { Requester } from "./core.js";

export type DocumentType =
  | "FARM_OWNERSHIP"
  | "OFFER_LETTER"
  | "PERMIT"
  | "LEASE_AGREEMENT"
  | "AFFIDAVIT"
  | "DEALER_LICENCE";

export type ApplicationStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED";

export type VerificationApplyInput = {
  idNumber: string;
  holderName: string;
  relationshipNote?: string;
  documentType: DocumentType;
  documentRef: string;
  affidavitCommissioned?: boolean;
  licenceNumber?: string;
  farmName?: string;
  province?: string;
  district?: string;
  saleLocation?: string;
};

export type VerificationApplication = {
  id: number;
  vendorId: number;
  status: ApplicationStatus;
  idNumber: string;
  idCheckStatus: string;
  holderName: string;
  relationshipNote: string | null;
  documentType: DocumentType;
  documentRef: string;
  affidavitCommissioned: boolean;
  licenceNumber: string | null;
  farmName: string | null;
  province: string | null;
  district: string | null;
  saleLocation: string | null;
  reviewerNote: string | null;
  reviewedBy: number | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PendingApplication = VerificationApplication & {
  vendor: { id: number; name: string; email: string };
};

export type VerificationStatus = {
  verified: boolean;
  applications: {
    id: number;
    status: ApplicationStatus;
    documentType: DocumentType;
    idCheckStatus: string;
    reviewerNote: string | null;
    reviewedAt: string | null;
    createdAt: string;
  }[];
};

export function createVerificationApi(request: Requester) {
  return {
    apply: (token: string, input: VerificationApplyInput) =>
      request<VerificationApplication>("POST", "/verification/apply", { token, body: input }),
    me: (token: string) => request<VerificationStatus>("GET", "/verification/me", { token }),
    pending: (adminToken: string) =>
      request<PendingApplication[]>("GET", "/verification/pending", { token: adminToken }),
    decide: (adminToken: string, id: number, decision: "APPROVED" | "REJECTED", reason: string) =>
      request<{ id: number; status: ApplicationStatus }>("POST", `/verification/${id}/decide`, {
        token: adminToken,
        body: { decision, reason },
      }),
  };
}
