import { can, type Permission, type RoleName } from "@/server/auth/permissions";

/** The signed-in staff member performing an operation. */
export interface Actor {
  id: string;
  email: string;
  name: string;
  role: RoleName;
}

/** Thrown when an operation is attempted without the required permission. */
export class PermissionError extends Error {
  permission: Permission;

  constructor(permission: Permission) {
    super(`You do not have permission to do this (${permission}).`);
    this.name = "PermissionError";
    this.permission = permission;
  }
}

/** Thrown for business-rule violations that should be shown to the user. */
export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessError";
  }
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!can(actor.role, permission)) throw new PermissionError(permission);
}
