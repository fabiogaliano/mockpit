// Knob schema and value validation (plan Q3: values are checked against the
// declared schema before they are stored or used). Runtime-agnostic. The config
// shape mirrors tunekit's usePane config; see the knob types in types.ts.

import type {
  ExplicitKnob,
  KnobAxis,
  KnobConfig,
  KnobOption,
  Knobs,
  KnobValue,
  Mock,
  Post,
} from "./types.ts";

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_KNOBS = 100;
const MAX_OPTIONS = 100;
const MAX_STRING = 500;
const MAX_TEXT_VALUE = 2000;
// A path is "size" (global) or "<part>.<name>"; segments stay CSS/attribute-safe
// because the bridge turns them into `--k-<path>` vars and `data-k-<path>` attrs.
const PATH_RE = /^[A-Za-z_][\w-]{0,63}(\.[A-Za-z_][\w-]{0,63}){0,3}$/;
// Color values end up inside CSS custom properties, so only the characters a
// CSS color or gradient needs are allowed.
const COLOR_RE = /^[#\w\s(),.%/+-]{1,300}$/;
const COLOR_HINT =
  /^(#|rgba?\(|hsla?\(|hwb\(|lab\(|lch\(|oklab\(|oklch\(|color\(|(linear|radial|conic)-gradient\()/i;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown, max = MAX_STRING): v is string =>
  typeof v === "string" && v.length <= max;

function checkAxis(raw: unknown, name: string): Checked<KnobAxis> {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 4 || !raw.every(isNum)) {
    return { ok: false, error: `${name} must be [default, min, max, step?] numbers` };
  }
  const [value, min, max, step] = raw as number[];
  if (min > max) return { ok: false, error: `${name} min is above max` };
  if (value < min || value > max)
    return { ok: false, error: `${name} default is outside min..max` };
  if (step !== undefined && step <= 0) return { ok: false, error: `${name} step must be positive` };
  return { ok: true, value: raw.slice() as KnobAxis };
}

function checkOptions(raw: unknown, name: string): Checked<KnobOption[]> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_OPTIONS) {
    return { ok: false, error: `${name} options must be a non-empty array` };
  }
  const out: KnobOption[] = [];
  for (const o of raw) {
    if (isStr(o)) out.push(o);
    else if (o && typeof o === "object" && isStr(o.value) && isStr(o.label)) {
      out.push({ value: o.value, label: o.label });
    } else return { ok: false, error: `${name} options must be strings or {value, label}` };
  }
  return { ok: true, value: out };
}

const optionValues = (options: KnobOption[] | undefined) =>
  (options ?? []).map((o) => (typeof o === "string" ? o : o.value));

// Expand tunekit's shorthands into an explicit control, the same way tunekit's
// config parser does (a string is a color when it looks like one, else text).
export function explicitKnob(config: KnobConfig): ExplicitKnob {
  if (Array.isArray(config)) {
    const [value, min, max, step] = config;
    return { type: "slider", value, min, max, ...(step === undefined ? {} : { step }) };
  }
  if (typeof config === "number") {
    if (config >= 0 && config <= 1) return { type: "slider", value: config, min: 0, max: 1 };
    if (config >= 0) return { type: "slider", value: config, min: 0, max: config * 3 || 10 };
    return { type: "slider", value: config, min: config * 3, max: -config * 3 };
  }
  if (typeof config === "boolean") return { type: "toggle", value: config };
  if (typeof config === "string") {
    return COLOR_HINT.test(config)
      ? { type: "color", value: config }
      : { type: "text", value: config };
  }
  return config;
}

// Validate one declared knob and return a clean copy (unknown keys dropped).
export function checkKnobConfig(path: string, raw: unknown): Checked<KnobConfig> {
  const name = `knob "${path}"`;
  if (Array.isArray(raw)) return checkAxis(raw, name);
  if (isNum(raw) || typeof raw === "boolean") return { ok: true, value: raw };
  if (typeof raw === "string") {
    return raw.length <= MAX_STRING
      ? { ok: true, value: raw }
      : { ok: false, error: `${name} is too long` };
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: `${name} is not a knob` };
  const k = raw as Record<string, any>;
  switch (k.type) {
    case "slider": {
      const axis = checkAxis(
        [k.value, k.min, k.max, ...(k.step === undefined ? [] : [k.step])],
        name,
      );
      if (!axis.ok) return axis;
      const [value, min, max, step] = axis.value;
      return {
        ok: true,
        value: { type: "slider", value, min, max, ...(step === undefined ? {} : { step }) },
      };
    }
    case "toggle":
      return typeof k.value === "boolean"
        ? { ok: true, value: { type: "toggle", value: k.value } }
        : { ok: false, error: `${name} toggle needs a boolean value` };
    case "select": {
      const options = checkOptions(k.options, name);
      if (!options.ok) return options;
      if (k.value !== undefined && !optionValues(options.value).includes(k.value)) {
        return { ok: false, error: `${name} value is not one of its options` };
      }
      return {
        ok: true,
        value: {
          type: "select",
          options: options.value,
          ...(k.value === undefined ? {} : { value: k.value }),
        },
      };
    }
    case "color": {
      if (k.value !== undefined && !(typeof k.value === "string" && COLOR_RE.test(k.value))) {
        return { ok: false, error: `${name} color value is not a CSS color` };
      }
      return {
        ok: true,
        value: {
          type: "color",
          ...(k.value === undefined ? {} : { value: k.value }),
          ...(k.gradient === true ? { gradient: true } : {}),
          ...(isStr(k.contrast) && COLOR_RE.test(k.contrast) ? { contrast: k.contrast } : {}),
        },
      };
    }
    case "text":
      if (k.value !== undefined && !isStr(k.value, MAX_TEXT_VALUE)) {
        return { ok: false, error: `${name} text value must be a string` };
      }
      return {
        ok: true,
        value: {
          type: "text",
          ...(k.value === undefined ? {} : { value: k.value }),
          ...(isStr(k.placeholder) ? { placeholder: k.placeholder } : {}),
        },
      };
    case "spring": {
      const out: Record<string, unknown> = { type: "spring" };
      for (const key of ["stiffness", "damping", "mass", "visualDuration", "bounce"]) {
        if (k[key] === undefined) continue;
        if (!isNum(k[key])) return { ok: false, error: `${name} ${key} must be a number` };
        out[key] = k[key];
      }
      return { ok: true, value: out as unknown as ExplicitKnob };
    }
    case "easing": {
      if (!isNum(k.duration) || k.duration < 0) {
        return { ok: false, error: `${name} easing needs a duration` };
      }
      if (!Array.isArray(k.ease) || k.ease.length !== 4 || !k.ease.every(isNum)) {
        return { ok: false, error: `${name} ease must be four numbers` };
      }
      return {
        ok: true,
        value: {
          type: "easing",
          duration: k.duration,
          ease: [...k.ease] as [number, number, number, number],
        },
      };
    }
    case "image": {
      let options: KnobOption[] | undefined;
      if (k.options !== undefined) {
        const checked = checkOptions(k.options, name);
        if (!checked.ok) return checked;
        options = checked.value;
      }
      if (k.value !== undefined && !isStr(k.value, MAX_TEXT_VALUE)) {
        return { ok: false, error: `${name} image value must be a string` };
      }
      return {
        ok: true,
        value: {
          type: "image",
          ...(k.value === undefined ? {} : { value: k.value }),
          ...(options ? { options } : {}),
        },
      };
    }
    case "pad": {
      const out: Record<string, unknown> = { type: "pad" };
      for (const axis of ["x", "y"] as const) {
        if (k[axis] === undefined) continue;
        const checked = checkAxis(k[axis], `${name} ${axis}`);
        if (!checked.ok) return checked;
        out[axis] = checked.value;
      }
      if (k.labels && typeof k.labels === "object") {
        out.labels = {
          ...(isStr(k.labels.x) ? { x: k.labels.x } : {}),
          ...(isStr(k.labels.y) ? { y: k.labels.y } : {}),
        };
      }
      return { ok: true, value: out as unknown as ExplicitKnob };
    }
    default:
      return { ok: false, error: `${name} has unknown type "${String(k.type)}"` };
  }
}

export function checkKnobs(raw: unknown): Checked<Knobs> {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "knobs must be an object of path → knob" };
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_KNOBS) return { ok: false, error: `at most ${MAX_KNOBS} knobs` };
  const out: Knobs = {};
  for (const [path, config] of entries) {
    if (!PATH_RE.test(path)) {
      return { ok: false, error: `knob path "${path}" must be "name" or "part.name"` };
    }
    const checked = checkKnobConfig(path, config);
    if (!checked.ok) return checked;
    out[path] = checked.value;
  }
  return { ok: true, value: out };
}

const axisOf = (axis: KnobAxis | undefined): [number, number] =>
  axis ? [axis[1], axis[2]] : [-1, 1];

// Whether `value` is something the declared knob could hold.
export function checkKnobValue(
  path: string,
  config: KnobConfig,
  value: unknown,
): Checked<KnobValue> {
  const knob = explicitKnob(config);
  const bad = (what: string): Checked<KnobValue> => ({
    ok: false,
    error: `value for knob "${path}" ${what}`,
  });
  switch (knob.type) {
    case "slider":
      if (!isNum(value)) return bad("must be a number");
      if (value < knob.min || value > knob.max)
        return bad(`must be within ${knob.min}..${knob.max}`);
      return { ok: true, value };
    case "toggle":
      return typeof value === "boolean" ? { ok: true, value } : bad("must be true or false");
    case "select":
      return typeof value === "string" && optionValues(knob.options).includes(value)
        ? { ok: true, value }
        : bad(`must be one of ${optionValues(knob.options).join(", ")}`);
    case "color":
      return typeof value === "string" && COLOR_RE.test(value)
        ? { ok: true, value }
        : bad("must be a CSS color");
    case "text":
      return isStr(value, MAX_TEXT_VALUE) ? { ok: true, value } : bad("must be a string");
    case "image":
      if (!isStr(value, MAX_TEXT_VALUE)) return bad("must be a string");
      if (knob.options && !optionValues(knob.options).includes(value)) {
        return bad(`must be one of ${optionValues(knob.options).join(", ")}`);
      }
      return { ok: true, value };
    case "pad": {
      if (!value || typeof value !== "object") return bad("must be {x, y}");
      const { x, y } = value as Record<string, unknown>;
      const [xMin, xMax] = axisOf(knob.x);
      const [yMin, yMax] = axisOf(knob.y);
      if (!isNum(x) || !isNum(y) || x < xMin || x > xMax || y < yMin || y > yMax) {
        return bad("must be {x, y} within the pad's range");
      }
      return { ok: true, value: { x, y } };
    }
    case "spring":
    case "easing": {
      // tunekit lets a transition knob switch between spring and easing modes.
      const checked = checkKnobConfig(path, value);
      if (!checked.ok) return checked;
      const t = checked.value as ExplicitKnob;
      return t && typeof t === "object" && (t.type === "spring" || t.type === "easing")
        ? { ok: true, value: t }
        : bad("must be a spring or easing");
    }
  }
}

// The declared knob for a path: the mock's own, else a variant's override.
export function knobFor(
  path: string,
  mock: Pick<Mock, "knobs">,
  posts: Pick<Post, "knobs">[],
): KnobConfig | undefined {
  if (Object.hasOwn(mock.knobs, path)) return mock.knobs[path];
  for (const p of posts) if (p.knobs && Object.hasOwn(p.knobs, path)) return p.knobs[path];
  return undefined;
}

export function checkKnobValues(
  raw: unknown,
  mock: Pick<Mock, "knobs">,
  posts: Pick<Post, "knobs">[],
  what: string,
): Checked<Record<string, KnobValue>> {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `${what} must be an object of knob path → value` };
  }
  const out: Record<string, KnobValue> = {};
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    const config = knobFor(path, mock, posts);
    if (config === undefined) return { ok: false, error: `${what}: no knob "${path}" is declared` };
    const checked = checkKnobValue(path, config, value);
    if (!checked.ok) return checked;
    out[path] = checked.value;
  }
  return { ok: true, value: out };
}

// How many discrete choices a knob offers, or null when it is continuous. A knob
// with only a handful is usually a decision dressed as a control (plan D12).
export function discreteChoices(config: KnobConfig): number | null {
  const knob = explicitKnob(config);
  if (knob.type === "toggle") return 2;
  if (knob.type === "select") return knob.options.length;
  if (knob.type === "image" && knob.options) return knob.options.length;
  return null;
}
