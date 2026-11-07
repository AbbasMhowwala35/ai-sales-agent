import { Activity } from '../models/index.js';

export function logActivity(businessId: unknown, leadId: unknown, type: string, message: string, meta?: Record<string, unknown>, userId?: unknown) {
  return Activity.create({ businessId, leadId, type, message, meta, userId });
}
