import { API_URL } from "./config";

export interface GameServer {
  number: number;
  name: string;
  color: string;
  isActive: boolean;
}

export interface HealthResponse {
  status: "ok";
  version: string;
  time: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: { Accept: "application/json", ...init?.headers },
    });
    if (!response.ok) {
      throw new ApiError(`Сервер ответил ошибкой ${response.status}`, response.status);
    }
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const api = {
  health: () => request<HealthResponse>("/health"),
  servers: () => request<{ items: GameServer[] }>("/v1/servers"),
};
