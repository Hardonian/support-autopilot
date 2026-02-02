import { z } from 'zod';
import { TenantContextSchema } from './tenant.js';

export const TicketStatusSchema = z.enum([
  'open',
  'pending',
  'resolved',
  'closed',
]);

export const TicketPrioritySchema = z.enum([
  'low',
  'medium',
  'high',
  'urgent',
]);

export const TicketSchema = z.object({
  ...TenantContextSchema.shape,
  id: z.string().min(1),
  subject: z.string().min(1),
  body: z.string(),
  status: TicketStatusSchema,
  priority: TicketPrioritySchema.default('medium'),
  customer_email: z.string().email().optional(),
  customer_name: z.string().optional(),
  created_at: z.string().datetime().or(z.date()),
  updated_at: z.string().datetime().or(z.date()).optional(),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export type Ticket = z.infer<typeof TicketSchema>;
export type TicketStatus = z.infer<typeof TicketStatusSchema>;
export type TicketPriority = z.infer<typeof TicketPrioritySchema>;

export const TicketArraySchema = z.array(TicketSchema);

export function validateTicket(data: unknown): Ticket {
  return TicketSchema.parse(data);
}

export function validateTickets(data: unknown): Ticket[] {
  return TicketArraySchema.parse(data);
}
