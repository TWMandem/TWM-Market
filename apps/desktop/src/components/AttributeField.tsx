import { useId } from "react";
import { unitParts, type AttributeDefinition, type AttributeValue } from "@twm/shared";

/**
 * Поле характеристики, построенное по описанию из конструктора.
 * Используется в предпросмотре конструктора, а на шаге 4 — в форме объявления.
 */
export function AttributeField({
  definition,
  value,
  onChange,
  error,
}: {
  definition: AttributeDefinition;
  value: AttributeValue | undefined;
  onChange: (value: AttributeValue | undefined) => void;
  error?: string | undefined;
}) {
  const id = useId();
  const label = (
    <span className="text-sm text-muted">
      {definition.label}
      {definition.required && <span className="text-danger"> *</span>}
    </span>
  );
  const help = (error || definition.helpText) && (
    <span className={`text-[13px] ${error ? "text-danger" : "text-faint"}`}>{error ?? definition.helpText}</span>
  );
  const inputClass = `h-12 w-full rounded-xl border bg-ground px-3.5 text-ink outline-none focus:border-accent ${
    error ? "border-[#c45555]" : "border-line"
  }`;

  switch (definition.dataType) {
    case "number": {
      // «X{}» — значение внутри шаблона: X перед полем ввода.
      const { prefix, suffix } = unitParts(definition.unit);
      return (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id}>{label}</label>
          <div className="flex items-center gap-2">
            {prefix && <span className="shrink-0 font-mono text-sm font-bold text-muted">{prefix}</span>}
            <input
              id={id}
              type="number"
              inputMode="decimal"
              min={definition.minValue ?? undefined}
              max={definition.maxValue ?? undefined}
              step={definition.stepValue ?? "any"}
              value={typeof value === "number" ? value : ""}
              onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
              className={inputClass}
            />
            {suffix && <span className="shrink-0 text-sm text-muted">{suffix}</span>}
          </div>
          {help}
        </div>
      );
    }
    case "text":
      return (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id}>{label}</label>
          <input
            id={id}
            maxLength={200}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
            className={inputClass}
          />
          {help}
        </div>
      );
    case "boolean":
      return (
        <div className="flex flex-col gap-1.5">
          <label className="flex min-h-12 cursor-pointer items-center gap-3 text-[15px] text-ink-2">
            <input
              type="checkbox"
              checked={value === true}
              onChange={(e) => onChange(e.target.checked)}
              className="size-[18px] accent-accent"
            />
            {definition.label}
          </label>
          {help}
        </div>
      );
    case "select":
      return (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id}>{label}</label>
          <select
            id={id}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
            className={inputClass}
          >
            <option value="">Не выбрано</option>
            {definition.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {help}
        </div>
      );
    case "multiselect": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1.5">{label}</legend>
          <div className="flex flex-wrap gap-2">
            {definition.options.map((option) => {
              const on = selected.includes(option);
              return (
                <label
                  key={option}
                  className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${
                    on ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-2"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => {
                      const next = e.target.checked ? [...selected, option] : selected.filter((o) => o !== option);
                      onChange(next.length ? next : undefined);
                    }}
                    className="size-4 accent-accent"
                  />
                  {option}
                </label>
              );
            })}
          </div>
          {help}
        </fieldset>
      );
    }
  }
}
