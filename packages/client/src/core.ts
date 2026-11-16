export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(messageFrom(status, body));
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function messageFrom(status: number, body: unknown): string {
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return `Request failed with status ${status}`;
}

export type QueryValue = string | number | boolean | undefined;

export type RequestOptions = {
  token?: string;
  body?: unknown;
  query?: Record<string, QueryValue>;
};

export type Requester = <T>(method: string, path: string, options?: RequestOptions) => Promise<T>;

export function createRequester(baseUrl: string): Requester {
  const root = baseUrl.replace(/\/$/, "");

  return async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    let url = root + path;
    if (options.query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) params.set(key, String(value));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = {};
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    let payload: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(options.body);
    }

    const res = await fetch(url, { method, headers, body: payload });
    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data as T;
  };
}
