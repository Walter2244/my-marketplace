import type { Requester } from "./core.js";

export type AgentStatus = "ACTIVE" | "SUSPENDED";

export type Agent = { id: number; name: string; phone: string; status: AgentStatus; createdAt: string };

export type AgentLink = {
  id: number;
  agentId: number;
  vendorId: number;
  startedAt: string;
  endedAt: string | null;
  endedBy: string | null;
};

// Returns null for the agent when the vendor has no active agent
export type CurrentAgent = { agent: { id: number; name: string } | null; startedAt?: string };

export type CommissionPaid = { id: number; paidOut: boolean };

export function createAgentsApi(request: Requester) {
  return {
    admin: {
      register: (adminToken: string, input: { name: string; phone: string }) =>
        request<Agent>("POST", "/agents", { token: adminToken, body: input }),
      setStatus: (adminToken: string, id: number, status: AgentStatus) =>
        request<Agent>("POST", `/agents/${id}/status`, { token: adminToken, body: { status } }),
      markCommissionPaid: (adminToken: string, commissionId: number) =>
        request<CommissionPaid>("POST", `/agents/commissions/${commissionId}/paid`, { token: adminToken }),
    },
    vendor: {
      link: (token: string, agentId: number) =>
        request<AgentLink>("POST", "/agents/link", { token, body: { agentId } }),
      unlink: (token: string) => request<AgentLink>("POST", "/agents/unlink", { token }),
      current: (token: string) => request<CurrentAgent>("GET", "/agents/me", { token }),
    },
  };
}
