import type { Requester } from "./core.js";

export type ProducerGroup = { id: number; name: string; leadId: number; listed: boolean; createdAt: string };

export type GroupMember = { id: number; groupId: number; vendorId: number; sharePercent: number };

export type GroupShareRecord = { amountCents: number; subOrderId: number; createdAt: string };

// A member's view of their own shares. Other members are never included.
export type MemberShares = {
  group: string;
  sharePercent: number;
  totalCents: number;
  shares: GroupShareRecord[];
};

export function createGroupsApi(request: Requester) {
  return {
    create: (token: string, name: string) =>
      request<ProducerGroup>("POST", "/groups", { token, body: { name } }),
    addMember: (token: string, vendorId: number, sharePercent: number) =>
      request<GroupMember>("POST", "/groups/members", { token, body: { vendorId, sharePercent } }),
    list: (token: string) => request<ProducerGroup>("POST", "/groups/list", { token }),
    myShares: (token: string) => request<MemberShares[]>("GET", "/groups/my-shares", { token }),
  };
}
