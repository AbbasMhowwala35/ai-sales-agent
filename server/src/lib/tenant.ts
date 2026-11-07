import type { Schema } from 'mongoose';

/**
 * Multi-tenant guard: every query on a tenant-scoped model MUST filter by businessId.
 * Prevents accidental cross-tenant reads/writes. Use `.setOptions({ crossTenant: true })`
 * only for internal system jobs (workers) that legitimately operate across tenants.
 */
export function tenantPlugin(schema: Schema) {
  schema.add({ businessId: { type: 'ObjectId', ref: 'Business', required: true, index: true } } as any);
  const ops = [
    'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'countDocuments',
    'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'replaceOne',
  ] as const;
  for (const op of ops) {
    schema.pre(op as any, function (this: any) {
      const opts = this.getOptions?.() ?? {};
      if (opts.crossTenant) return;
      const filter = this.getFilter?.() ?? {};
      if (!('businessId' in filter)) {
        throw new Error(`Tenant isolation violation: ${op} on ${this.model?.modelName} without businessId`);
      }
    });
  }
  schema.pre('aggregate', function (this: any) {
    if (this.options?.crossTenant) return;
    const first = this.pipeline()[0];
    if (!first || !first.$match || !('businessId' in first.$match)) {
      throw new Error('Tenant isolation violation: aggregate must start with $match on businessId');
    }
  });
}

/** Populate a tenant-scoped ref. Safe: referenced ids come from a parent document already filtered by businessId. */
export const tp = (path: string, select?: string) => ({ path, select, options: { crossTenant: true } });
