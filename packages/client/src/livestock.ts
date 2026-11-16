import type { Requester } from "./core.js";

export type HealthRecordKind = "VACCINATION" | "TREATMENT" | "CHECKUP";

export type AnimalIdentification = { id: number; productId: number; tagNumber: string; createdAt: string };
export type HealthRecord = {
  id: number;
  productId: number;
  kind: HealthRecordKind;
  description: string;
  recordedOn: string;
  createdAt: string;
};
export type HealthDeclaration = { id: number; productId: number; statement: string; declaredAt: string };

export type HealthRecordInput = { kind: HealthRecordKind; description: string; recordedOn: string };

// What a buyer sees on a published listing. Vendor-only fields are not included.
export type PublicLivestockRecords = {
  identification: { tagNumber: string } | null;
  healthRecords: { kind: HealthRecordKind; description: string; recordedOn: string }[];
  declaration: { statement: string; declaredAt: string } | null;
};

export function createLivestockApi(request: Requester) {
  return {
    identification: {
      set: (token: string, productId: number, tagNumber: string) =>
        request<AnimalIdentification>("PUT", `/livestock/${productId}/identification`, { token, body: { tagNumber } }),
    },
    healthRecords: {
      add: (token: string, productId: number, input: HealthRecordInput) =>
        request<HealthRecord>("POST", `/livestock/${productId}/health-records`, { token, body: input }),
    },
    declaration: {
      make: (token: string, productId: number) =>
        request<HealthDeclaration>("POST", `/livestock/${productId}/declaration`, { token, body: { agreed: true } }),
    },
    records: (productId: number) =>
      request<PublicLivestockRecords>("GET", `/livestock/${productId}/records`),
  };
}
