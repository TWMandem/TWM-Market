import { useCallback, useState, type FormEvent } from "react";
import { fieldErrors } from "@twm/shared";
import type { ZodTypeAny, z } from "zod";
import { ApiError } from "./api";

/**
 * Общая логика форм: значения, проверка той же схемой, что на сервере,
 * отправка и разбор ошибок сервера по полям.
 */
export function useForm<S extends ZodTypeAny, V extends Record<string, unknown>>(
  schema: S,
  initial: V,
  submit: (data: z.infer<S>) => Promise<void>,
) {
  const [values, setValues] = useState<V>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = useCallback(<K extends keyof V>(key: K, value: V[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  }, []);

  const onSubmit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (submitting) return;
      setFormError(null);
      const parsed = schema.safeParse(values);
      if (!parsed.success) {
        setErrors(fieldErrors(parsed.error));
        return;
      }
      setErrors({});
      setSubmitting(true);
      try {
        await submit(parsed.data);
      } catch (error) {
        if (error instanceof ApiError) {
          setErrors(error.fields);
          // Если ошибка привязана к полю, общее сообщение не дублируем.
          if (Object.keys(error.fields).length === 0 || error.code === "validation_error") {
            setFormError(error.code === "validation_error" ? null : error.message);
          }
        } else {
          setFormError("Что-то пошло не так. Попробуйте ещё раз.");
        }
      } finally {
        setSubmitting(false);
      }
    },
    [schema, values, submit, submitting],
  );

  return { values, set, setValues, errors, formError, setFormError, submitting, onSubmit };
}
