import type { Request } from 'express';
import { AuditLog } from '../models/index.js';
import { logger } from '../lib/logger.js';

export async function audit(req: Request | null, action: string, entity?: string, entityId?: unknown, meta?: Record<string, unknown>, businessId?: unknown) {
  try {
    await AuditLog.create({
      businessId: businessId ?? req?.tenant?.businessId,
      userId: req?.auth?.userId,
      action,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      ip: req?.ip,
      meta,
    });
  } catch (e) {
    logger.warn({ e, action }, 'audit write failed');
  }
}
