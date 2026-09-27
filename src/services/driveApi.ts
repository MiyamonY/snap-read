export interface DriveStatus {
  configured: boolean;
  connected: boolean;
  email?: string;
  pendingUploads: number;
  lastError?: string;
}

const API_BASE = "/api/auth/google";

export const DRIVE_LOGIN_URL = `${API_BASE}/login`;

export const driveApi = {
  async status(): Promise<DriveStatus> {
    const res = await fetch(`${API_BASE}/status`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as DriveStatus;
  },

  async logout(): Promise<void> {
    const res = await fetch(`${API_BASE}/logout`, { method: "POST" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  },
};
