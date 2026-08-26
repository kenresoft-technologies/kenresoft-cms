import type { Context } from 'hono';
import type { ZodType } from 'zod';

export async function parseJsonBody<T>(
  c: Context,
  schema: ZodType<T>,
): Promise<{ data: T } | { error: Response }> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return { error: c.json({ error: 'Invalid JSON body' }, 400) };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    return { error: c.json({ error: 'Validation failed', issues: result.error.issues }, 400) };
  }

  return { data: result.data };
}
