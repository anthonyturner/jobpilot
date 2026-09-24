/** An expected, user-facing failure. The HTTP layer returns its message with the given status. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const conflict = (message: string) => new AppError(409, message);
export const notFound = (message: string) => new AppError(404, message);
export const forbidden = (message: string) => new AppError(403, message);
