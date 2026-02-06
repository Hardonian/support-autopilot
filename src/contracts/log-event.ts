import { z } from 'zod';
import { TenantContextSchema } from './tenant.js';

export const LogLevelSchema = z.enum([
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
]);

export type LogLevel = z.infer<typeof LogLevelSchema>;

export const LogEventSchema = z.object({
  ...TenantContextSchema.shape,
  timestamp: z.string().datetime(),
  level: LogLevelSchema,
  event_type: z.string().min(1),
  message: z.string().min(1),
  trace_id: z.string().min(1).optional(),
  span_id: z.string().min(1).optional(),
  module_id: z.enum(['support']).default('support'),
  context: z.record(z.unknown()).default({}),
});

export type LogEvent = z.infer<typeof LogEventSchema>;

export function validateLogEvent(data: unknown): LogEvent {
  return LogEventSchema.parse(data);
}

export function createLogEvent(
  tenantId: string,
  projectId: string,
  level: LogLevel,
  eventType: string,
  message: string,
  options?: {
    traceId?: string;
    spanId?: string;
    context?: Record<string, unknown>;
  }
): LogEvent {
  return LogEventSchema.parse({
    tenant_id: tenantId,
    project_id: projectId,
    timestamp: new Date().toISOString(),
    level,
    event_type: eventType,
    message,
    trace_id: options?.traceId,
    span_id: options?.spanId,
    module_id: 'support',
    context: options?.context ?? {},
  });
}
