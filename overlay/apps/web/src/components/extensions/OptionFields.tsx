"use client";

import { useEffect, useState } from "react";
import type { ExtensionOption, ExtensionValues } from "@/lib/extensions/types";

/**
 * The fields of an extension's options. Numbers and text commit on Enter or leaving the field; switches,
 * lists and colours at once. `onCommit` gets every value, not only the one that changed.
 */
export function OptionFields({ options, values, disabled = false, onCommit }: {
  options: readonly ExtensionOption[];
  values: ExtensionValues;
  disabled?: boolean;
  onCommit: (values: ExtensionValues) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Values from outside (another object picked, a rebuild) replace whatever was being typed.
  const valuesKey = JSON.stringify(values);
  useEffect(() => setDrafts({}), [valuesKey]);

  const commit = (key: string, value: ExtensionValues[string]) => {
    if (values[key] === value) return;
    onCommit({ ...values, [key]: value });
  };

  return (
    <div className="extension-fields">
      {options.map((option) => {
        const id = `extension-field-${option.key}`;
        const current = values[option.key];
        if (option.type === "boolean") {
          return (
            <label key={option.key} className="extension-field extension-field-check" title={option.help}>
              <input type="checkbox" checked={current === true} disabled={disabled} onChange={(event) => commit(option.key, event.currentTarget.checked)} />
              <span>{option.label}</span>
            </label>
          );
        }
        if (option.type === "select") {
          return (
            <label key={option.key} className="extension-field" htmlFor={id} title={option.help}>
              <span>{option.label}</span>
              <select id={id} value={String(current ?? "")} disabled={disabled} onChange={(event) => commit(option.key, event.currentTarget.value)}>
                {option.options.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
              </select>
            </label>
          );
        }
        if (option.type === "color") {
          return (
            <label key={option.key} className="extension-field" htmlFor={id} title={option.help}>
              <span>{option.label}</span>
              <input id={id} type="color" value={String(current ?? "#888888")} disabled={disabled} onChange={(event) => commit(option.key, event.currentTarget.value)} />
            </label>
          );
        }
        const draft = drafts[option.key] ?? String(current ?? "");
        const finish = () => {
          if (drafts[option.key] === undefined) return;
          if (option.type === "number") {
            const typed = Number(draft.replace(",", "."));
            if (!Number.isFinite(typed)) {
              setDrafts(({ [option.key]: _dropped, ...rest }) => rest);
              return;
            }
            const step = option.step ?? 0;
            let next = Math.min(option.max ?? Infinity, Math.max(option.min ?? -Infinity, typed));
            if (step > 0) next = Math.round(next / step) * step;
            next = Math.round(next * 1e6) / 1e6;
            setDrafts(({ [option.key]: _dropped, ...rest }) => rest);
            commit(option.key, next);
          } else {
            setDrafts(({ [option.key]: _dropped, ...rest }) => rest);
            commit(option.key, draft);
          }
        };
        return (
          <label key={option.key} className="extension-field" htmlFor={id} title={option.help}>
            <span>{option.label}</span>
            <span className="extension-field-input">
              <input
                id={id}
                type="text"
                inputMode={option.type === "number" ? "decimal" : undefined}
                placeholder={option.type === "text" ? option.placeholder : undefined}
                value={draft}
                disabled={disabled}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  const text = event.currentTarget.value;
                  setDrafts((current) => ({ ...current, [option.key]: text }));
                }}
                onBlur={finish}
                onKeyDown={(event) => {
                  // Keys typed here must not reach the editor's shortcuts.
                  event.stopPropagation();
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setDrafts(({ [option.key]: _dropped, ...rest }) => rest);
                }}
              />
              {option.type === "number" && option.unit ? <span className="extension-field-unit">{option.unit}</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
