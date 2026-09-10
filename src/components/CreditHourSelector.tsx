import React, { useState, useEffect, useRef } from 'react';

interface CreditHourSelectorProps {
  value: number | string | null | undefined;
  onChange: (numericVal: number | null, stringVal: string) => void;
  label?: string;
  required?: boolean;
  className?: string;
  idPrefix?: string;
}


export const CreditHourSelector: React.FC<CreditHourSelectorProps> = ({
  value,
  onChange,
  label = 'Credits',
  required = false,
  className = '',
  idPrefix = 'credits',
}) => {
  const PRESET_CREDITS = [0, 3, 4, 5];

  const numericValue =
    value !== null && value !== undefined && value !== '' && !isNaN(Number(value))
      ? Number(value)
      : null;

  const isPreset = numericValue !== null && PRESET_CREDITS.includes(numericValue);

  // If the initial value is non-empty and not in presets (e.g. 1, 2, 6), default to "other" open
  const [isOtherSelected, setIsOtherSelected] = useState<boolean>(() => {
    return !isPreset && value !== null && value !== undefined && value !== '';
  });

  const customInputRef = useRef<HTMLInputElement>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
  }, []);

  // Keep other selection synced if value changes to a preset or outside
  useEffect(() => {
    if (numericValue !== null && PRESET_CREDITS.includes(numericValue) && !isOtherSelected) {
      // Matches preset cleanly
    } else if (numericValue !== null && !PRESET_CREDITS.includes(numericValue)) {
      setIsOtherSelected(true);
    }
  }, [numericValue, isPreset]);

  const showOtherInput =
    isOtherSelected || (!isPreset && value !== null && value !== undefined && value !== '');

  const handleSelectPreset = (preset: number) => {
    setIsOtherSelected(false);
    onChange(preset, String(preset));
  };

  const handleSelectOther = () => {
    setIsOtherSelected(true);
    onChange(null, '');
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      focusTimerRef.current = setTimeout(() => {
      customInputRef.current?.focus();
    }, 50);
  };

  const handleCustomInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '') {
      onChange(null, '');
      return;
    }
    const parsed = Math.max(0, Math.min(100, Number(raw)));
    onChange(isNaN(parsed) ? null : parsed, raw);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        <label htmlFor={`${idPrefix}-custom-input`} id={`${idPrefix}-label`} className="text-xs font-bold text-text-secondary uppercase tracking-wider block">
          {label} {required && '*'}
        </label>
        {numericValue !== null && (
          <span className="text-xs font-mono font-bold text-ink">
            {numericValue} credit{numericValue === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PRESET_CREDITS.map((preset) => {
          const isSelected = !showOtherInput && numericValue === preset;
          return (
            <button
              key={preset}
              id={`${idPrefix}-preset-${preset}`}
              type="button"
              aria-pressed={isSelected}
              onClick={() => handleSelectPreset(preset)}
              className={`min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-lg text-sm font-bold transition cursor-pointer border ${
                isSelected
                  ? 'bg-ink text-white border-ink shadow-xs'
                  : 'bg-white text-ink border-line-strong hover:border-ink hover:bg-mist'
              }`}
            >
              {preset}
            </button>
          );
        })}

        <button
          id={`${idPrefix}-preset-other`}
          type="button"
          aria-pressed={showOtherInput}
          onClick={handleSelectOther}
          className={`min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-lg text-sm font-bold transition cursor-pointer border ${
            showOtherInput
              ? 'bg-ink text-white border-ink shadow-xs'
              : 'bg-white text-ink border-line-strong hover:border-ink hover:bg-mist'
          }`}
        >
          Other
        </button>
      </div>

      {showOtherInput && (
        <div className="flex items-center gap-2 pt-1">
          <input
            ref={customInputRef}
            id={`${idPrefix}-custom-input`}
            type="number"
            min="0"
            max="100"
            inputMode="decimal"
            step="0.5"
            value={value ?? ''}
            onChange={handleCustomInputChange}
            placeholder="Credits"
            className="w-28 min-h-[44px] px-3 py-2 bg-white border border-line-strong rounded-lg text-sm font-bold text-ink font-mono focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            aria-labelledby={`${idPrefix}-label`}
            aria-required={required || undefined}
          />
        </div>
      )}
    </div>
  );
};
