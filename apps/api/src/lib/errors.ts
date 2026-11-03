import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { fieldErrors, type ApiErrorBody } from "@twm/shared";

/** Ожидаемая ошибка с понятным сообщением для пользователя. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const errors = {
  validation: (fields: Record<string, string>) =>
    new AppError(400, "validation_error", "Проверьте правильность заполнения полей", fields),
  unauthorized: (message = "Нужно войти в аккаунт") => new AppError(401, "unauthorized", message),
  forbidden: (message = "Недостаточно прав") => new AppError(403, "forbidden", message),
  notFound: (message = "Не найдено") => new AppError(404, "not_found", message),
  conflict: (code: string, message: string, fields?: Record<string, string>) =>
    new AppError(409, code, message, fields),
};

/** Проверяет тело запроса схемой zod и возвращает данные или ошибку 400 по полям. */
export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw errors.validation(fieldErrors(result.error));
  return result.data;
}

export function registerErrorHandler(
  app: FastifyInstance,
  onInternalError?: (error: Error, request: FastifyRequest) => void,
): void {
  app.setErrorHandler((error: FastifyError | AppError | ZodError, request, reply) => {
    if (error instanceof AppError) {
      const body: ApiErrorBody = { error: error.code, message: error.message };
      if (error.fields) body.fields = error.fields;
      return reply.code(error.status).send(body);
    }
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send({ error: "validation_error", message: "Неверные данные", fields: fieldErrors(error) });
    }
    const status = (error as FastifyError).statusCode ?? 500;
    if (status === 413) {
      return reply.code(413).send({ error: "file_too_large", message: "Файл слишком большой" });
    }
    if (status === 406 || (error as FastifyError).code === "FST_INVALID_MULTIPART_CONTENT_TYPE") {
      return reply.code(400).send({ error: "file_required", message: "Прикрепите файл" });
    }
    if (status === 429) {
      return reply.code(429).send({ error: "rate_limited", message: "Слишком много попыток. Подождите немного." });
    }
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: "bad_request", message: "Неверный запрос" });
    }
    request.log.error(error);
    onInternalError?.(error as Error, request);
    return reply.code(500).send({ error: "internal", message: "Внутренняя ошибка сервера. Попробуйте позже." });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: "not_found", message: `Маршрут ${request.method} ${request.url} не найден` });
  });
}
