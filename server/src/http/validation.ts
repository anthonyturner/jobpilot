import type { z } from 'zod';

export class ValidationError extends Error {
  readonly statusCode = 400;
  constructor(readonly issues: Array<{ path: string; message: string }>) {
    super('Invalid request');
    this.name = 'ValidationError';
  }
}

export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return result.data;
}
