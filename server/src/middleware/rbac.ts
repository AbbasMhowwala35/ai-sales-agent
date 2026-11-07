import type { Request, Response, NextFunction } from 'express';
import { forbidden } from '../lib/errors.js';
import type { Role } from '../models/index.js';

export const PERMISSIONS = {
  'business:write': ['owner', 'admin'],
  'knowledge:write': ['owner', 'admin', 'manager'],
  'agents:write': ['owner', 'admin', 'manager'],
  'leadgen:run': ['owner', 'admin', 'manager'],
  'leads:write': ['owner', 'admin', 'manager', 'agent'],
  'leads:approve': ['owner', 'admin', 'manager'],
  'leads:delete': ['owner', 'admin'],
  'campaigns:write': ['owner', 'admin', 'manager'],
  'calls:write': ['owner', 'admin', 'manager', 'agent'],
  'recordings:listen': ['owner', 'admin', 'manager', 'agent'],
  'recordings:download': ['owner', 'admin', 'manager'],
  'team:manage': ['owner', 'admin'],
  'compliance:write': ['owner', 'admin', 'manager'],
  'audit:read': ['owner', 'admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export const can = (role: Role, perm: Permission) => (PERMISSIONS[perm] as readonly Role[]).includes(role);

export function requirePermission(perm: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth || !can(req.auth.role, perm)) throw forbidden();
    next();
  };
}

export function permissionsFor(role: Role) {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}
