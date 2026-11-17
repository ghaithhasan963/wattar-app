/**
 * Wattar Admin — نافذة اختيار سبب جاهز
 * تستبدل window.prompt: المستخدم يختار من قائمة واضحة أو يكتب سببًا مخصصًا،
 * مع ملاحظة داخلية اختيارية.
 */
import { useState } from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';

export type ReasonTone = 'danger' | 'warning' | 'info';

export function ReasonPickerModal({
  title,
  subtitle,
  description,
  options,
  confirmLabel,
  tone = 'danger',
  processing,
  showNote = false,
  noteLabel = 'ملاحظة داخلية (اختياري)',
  onClose,
  onSubmit,
}: {
  title: string;
  subtitle?: string;
  description?: string;
  options: string[];
  confirmLabel: string;
  tone?: ReasonTone;
  processing?: boolean;
  showNote?: boolean;
  noteLabel?: string;
  onClose: () => void;
  onSubmit: (reason: string, note: string) => void;
}) {
  const [choice, setChoice] = useState(options[0] ?? '');
  const [custom, setCustom] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [note, setNote] = useState('');
  const reason = useCustom ? custom.trim() : choice;
  const canSubmit = Boolean(reason) && reason.length <= 500 && !processing;
  const palette = tone === 'warning'
    ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
    : tone === 'info'
      ? 'border-sky-500/30 bg-sky-500/10 text-sky-200'
      : 'border-red-500/30 bg-red-500/10 text-red-200';
  const confirmClass = tone === 'warning'
    ? 'bg-amber-700 hover:bg-amber-600'
    : tone === 'info'
      ? 'bg-sky-700 hover:bg-sky-600'
      : 'bg-red-700 hover:bg-red-600';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#171a2c]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            {subtitle ? <p className="mt-1 text-xs text-gray-400">{subtitle}</p> : null}
          </div>
          <button onClick={onClose} disabled={processing} className="text-gray-400 hover:text-white disabled:opacity-50" aria-label="إغلاق">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {description ? (
            <div className={`flex items-start gap-2 rounded-xl border p-3 text-xs leading-6 ${palette}`}>
              <AlertTriangle size={16} className="mt-1 shrink-0" />
              {description}
            </div>
          ) : null}

          <div className="max-h-64 space-y-2 overflow-y-auto pl-1">
            {options.map((option) => {
              const active = !useCustom && choice === option;
              return (
                <button
                  key={option}
                  type="button"
                  disabled={processing}
                  onClick={() => {
                    setChoice(option);
                    setUseCustom(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-right text-sm transition ${
                    active
                      ? 'border-wattar-400/50 bg-wattar-600/20 font-semibold text-white'
                      : 'border-white/[0.07] bg-white/[0.02] text-gray-300 hover:border-white/15'
                  }`}
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? 'border-wattar-300 bg-wattar-500' : 'border-gray-600'}`}>
                    {active ? <Check size={10} className="text-white" /> : null}
                  </span>
                  {option}
                </button>
              );
            })}
            <button
              type="button"
              disabled={processing}
              onClick={() => setUseCustom(true)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-right text-sm transition ${
                useCustom
                  ? 'border-wattar-400/50 bg-wattar-600/20 font-semibold text-white'
                  : 'border-dashed border-white/[0.12] bg-transparent text-gray-400 hover:border-white/20'
              }`}
            >
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${useCustom ? 'border-wattar-300 bg-wattar-500' : 'border-gray-600'}`}>
                {useCustom ? <Check size={10} className="text-white" /> : null}
              </span>
              سبب آخر (كتابة يدوية)
            </button>
          </div>

          {useCustom ? (
            <textarea
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              rows={3}
              maxLength={500}
              disabled={processing}
              placeholder="اكتب السبب…"
              className="w-full resize-y rounded-xl border border-white/[0.08] bg-[#111424] px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:border-wattar-400/60 focus:outline-none"
            />
          ) : null}

          {showNote ? (
            <label className="block">
              <span className="mb-1.5 block text-xs text-gray-400">{noteLabel}</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                maxLength={500}
                disabled={processing}
                placeholder="تظهر في سجل الإدارة"
                className="w-full resize-y rounded-xl border border-white/[0.08] bg-[#111424] px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:border-wattar-400/60 focus:outline-none"
              />
            </label>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={processing}
              className="rounded-xl border border-white/[0.08] px-4 py-2 text-sm text-gray-300 hover:bg-white/[0.04] disabled:opacity-50"
            >
              إلغاء
            </button>
            <button
              onClick={() => onSubmit(reason, note.trim())}
              disabled={!canSubmit}
              className={`flex min-w-32 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${confirmClass}`}
            >
              {processing ? <Loader2 size={16} className="animate-spin" /> : <Check size={15} />}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
