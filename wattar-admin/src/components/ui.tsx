/**
 * Wattar Admin — مكوّنات واجهة موحّدة
 * اختيارات واضحة (Toggle / Segmented / Select) بدل الكتابة اليدوية.
 */
import { ReactNode } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, Loader2, Save } from 'lucide-react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-gray-400">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  icon: Icon,
  actions,
  children,
  tone = 'default',
}: {
  title: string;
  description?: string;
  icon?: typeof Save;
  actions?: ReactNode;
  children: ReactNode;
  tone?: 'default' | 'primary' | 'warning';
}) {
  const toneClass = tone === 'primary'
    ? 'border-wattar-500/25 bg-wattar-600/[0.06]'
    : tone === 'warning'
      ? 'border-amber-400/20 bg-amber-400/[0.04]'
      : 'border-white/[0.07] bg-[#171a2c]';
  return (
    <section className={clsx('rounded-2xl border p-5', toneClass)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {Icon ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-wattar-300">
              <Icon size={17} />
            </span>
          ) : null}
          <div>
            <h2 className="text-base font-semibold text-white">{title}</h2>
            {description ? <p className="mt-1 text-xs leading-5 text-gray-500">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
  saving,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  saving?: boolean;
}) {
  return (
    <label className={clsx('flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 transition', disabled && 'cursor-not-allowed opacity-50')}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-100">{label}</span>
        {description ? <span className="mt-0.5 block text-xs leading-5 text-gray-500">{description}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {saving ? <Loader2 size={14} className="animate-spin text-wattar-300" /> : null}
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={clsx(
            'relative h-7 w-12 rounded-full transition',
            checked ? 'bg-wattar-500' : 'bg-gray-700',
          )}
        >
          <span
            className={clsx(
              'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all',
              checked ? 'right-1' : 'right-6',
            )}
          />
        </button>
      </span>
    </label>
  );
}

export interface ChoiceOption<T> {
  label: string;
  value: T;
  hint?: string;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  columns = 4,
}: {
  options: ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  columns?: number;
}) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={clsx(
              'rounded-xl border px-3 py-2.5 text-center text-sm transition',
              active
                ? 'border-wattar-400/50 bg-wattar-600/20 font-semibold text-white'
                : 'border-white/[0.07] bg-white/[0.02] text-gray-400 hover:border-white/15 hover:text-gray-100',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <span className="block">{option.label}</span>
            {option.hint ? <span className="mt-0.5 block text-[10px] text-gray-500">{option.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function SelectField({
  label,
  description,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-200">{label}</span>
      {description ? <span className="mb-2 block text-xs leading-5 text-gray-500">{description}</span> : null}
      <span className="relative block">
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="w-full appearance-none rounded-xl border border-white/[0.08] bg-[#111424] px-3 py-2.5 pl-9 text-sm text-white outline-none transition focus:border-wattar-400/60 disabled:opacity-50"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
      </span>
    </label>
  );
}

export function NumberField({
  label,
  description,
  value,
  onChange,
  unit,
  min,
  max,
  step = 1,
  disabled,
  dirty,
  saving,
  onSave,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  dirty?: boolean;
  saving?: boolean;
  onSave?: () => void;
}) {
  return (
    <div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-gray-200">{label}</span>
        {description ? <span className="mb-2 block text-xs leading-5 text-gray-500">{description}</span> : null}
        <span className="flex items-stretch gap-2">
          <input
            type="number"
            inputMode="decimal"
            value={value}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-[#111424] px-3 py-2.5 text-sm text-white outline-none transition focus:border-wattar-400/60 disabled:opacity-50"
          />
          {unit ? (
            <span className="flex items-center rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 text-xs text-gray-400">
              {unit}
            </span>
          ) : null}
          {onSave ? (
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || saving}
              className={clsx(
                'flex items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition',
                dirty
                  ? 'bg-wattar-600 text-white hover:bg-wattar-500'
                  : 'bg-white/[0.04] text-gray-500',
              )}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              حفظ
            </button>
          ) : null}
        </span>
      </label>
    </div>
  );
}

export function TextField({
  label,
  description,
  value,
  onChange,
  placeholder,
  multiline,
  rows = 3,
  dir,
  onSave,
  saving,
  dirty,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  dir?: 'rtl' | 'ltr';
  onSave?: () => void;
  saving?: boolean;
  dirty?: boolean;
}) {
  const className = 'w-full rounded-xl border border-white/[0.08] bg-[#111424] px-3 py-2.5 text-sm text-white outline-none transition focus:border-wattar-400/60';
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-200">{label}</span>
      {description ? <span className="mb-2 block text-xs leading-5 text-gray-500">{description}</span> : null}
      <span className="flex items-start gap-2">
        {multiline ? (
          <textarea
            dir={dir}
            value={value}
            rows={rows}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            className={`${className} resize-y`}
          />
        ) : (
          <input
            dir={dir}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            className={className}
          />
        )}
        {onSave ? (
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saving}
            className={clsx(
              'mt-0.5 flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium transition',
              dirty ? 'bg-wattar-600 text-white hover:bg-wattar-500' : 'bg-white/[0.04] text-gray-500',
            )}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          </button>
        ) : null}
      </span>
    </label>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const toneClass = {
    neutral: 'bg-white/[0.06] text-gray-300 border-white/[0.08]',
    success: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20',
    warning: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
    danger: 'bg-red-400/10 text-red-300 border-red-400/20',
    info: 'bg-sky-400/10 text-sky-300 border-sky-400/20',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-10 text-center">
      <p className="text-sm font-medium text-gray-300">{title}</p>
      {description ? <p className="mt-1 text-xs text-gray-500">{description}</p> : null}
    </div>
  );
}
