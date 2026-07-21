/**
 * Overlay props form GENERATED from the component's JSON-schema entry in
 * contracts/components_catalog.json (string / enum / number / boolean
 * widgets). Unknown components or free-form props are impossible by
 * construction — the form can only produce what the schema describes.
 */

export interface PropSchema {
  type?: string;
  enum?: string[];
  default?: unknown;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  description?: string;
}

export interface ObjectSchema {
  properties?: Record<string, PropSchema>;
  required?: string[];
}

/** Initial props for a new overlay: schema defaults, else cheapest valid value. */
export function defaultProps(schema: ObjectSchema): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    if (prop.default !== undefined) props[name] = prop.default;
    else if (schema.required?.includes(name)) {
      if (prop.enum) props[name] = prop.enum[0];
      else if (prop.type === "number" || prop.type === "integer") props[name] = prop.minimum ?? 0;
      else if (prop.type === "boolean") props[name] = false;
      else props[name] = "";
    }
  }
  return props;
}

export function PropsForm({
  schema,
  value,
  onCommit,
}: {
  schema: ObjectSchema;
  value: Record<string, unknown>;
  onCommit: (props: Record<string, unknown>) => void;
}) {
  const entries = Object.entries(schema.properties ?? {});
  if (entries.length === 0) {
    return <p className="text-xs text-neutral-500">This component takes no props.</p>;
  }

  const set = (name: string, v: unknown) => onCommit({ ...value, [name]: v });

  return (
    <div className="flex flex-col gap-2">
      {entries.map(([name, prop]) => (
        <label key={name} className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-neutral-500">
            {name}
            {schema.required?.includes(name) ? " *" : ""}
          </span>
          <Widget name={name} prop={prop} value={value[name]} onChange={(v) => set(name, v)} />
        </label>
      ))}
    </div>
  );
}

const INPUT_CLASS =
  "w-full rounded bg-neutral-800 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-neutral-600";

function Widget({
  name,
  prop,
  value,
  onChange,
}: {
  name: string;
  prop: PropSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (prop.enum) {
    return (
      <select
        value={String(value ?? prop.default ?? prop.enum[0])}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLASS}
      >
        {prop.enum.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (prop.type === "number" || prop.type === "integer") {
    return (
      <input
        type="number"
        defaultValue={value as number | undefined}
        min={prop.minimum}
        max={prop.maximum}
        step={prop.type === "integer" ? 1 : "any"}
        onBlur={(e) => onChange(prop.type === "integer" ? parseInt(e.target.value || "0", 10) : Number(e.target.value || 0))}
        className={INPUT_CLASS}
      />
    );
  }
  if (prop.type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-neutral-300"
      />
    );
  }
  return (
    <input
      key={name}
      type="text"
      defaultValue={(value as string | undefined) ?? ""}
      maxLength={prop.maxLength}
      onBlur={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={INPUT_CLASS}
    />
  );
}
