import type { Role } from "@twm/shared";

/** Строки таблиц в том виде, в каком их возвращает postgres.js (camelCase). */

export interface UserRow {
  id: string;
  login: string;
  email: string;
  passwordHash: string;
  role: Role;
  status: "active" | "blocked";
  emailVerifiedAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  prevTokenHash: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface ServerRow {
  id: number;
  number: number;
  name: string;
  color: string;
  isActive: boolean;
  transferOpen: boolean;
  sortOrder: number;
}

export interface EmailCodeRow {
  id: string;
  userId: string;
  purpose: "verify_email" | "reset_password";
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}
