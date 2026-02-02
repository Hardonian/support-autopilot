import { z } from 'zod';

export const TenantContextSchema = z.object({
  tenant_id: z.string().min(1, 'tenant_id is required'),
  project_id: z.string().min(1, 'project_id is required'),
});

export type TenantContext = z.infer<typeof TenantContextSchema>;

export function validateTenantContext(context: unknown): TenantContext {
  return TenantContextSchema.parse(context);
}

export function withTenant<T extends z.AnyZodObject>(schema: T): z.ZodObject<{
  tenant_id: z.ZodString;
  project_id: z.ZodString;
} & z.infer<T>> {
  return TenantContextSchema.merge(schema) as unknown as z.ZodObject<{
    tenant_id: z.ZodString;
    project_id: z.ZodString;
  } & z.infer<T>>;
}
