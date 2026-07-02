import type { ThemeMode } from '../settings/theme';

const OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

interface ThemeControlProps {
  mode: ThemeMode;
  onSetMode: (mode: ThemeMode) => void;
}

/** Presentational System/Light/Dark segmented control. No storage/hook here. */
export function ThemeControl({ mode, onSetMode }: ThemeControlProps) {
  return (
    <div className="theme-control" role="group" aria-label="Color theme">
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          className={mode === value ? 'active' : ''}
          aria-pressed={mode === value}
          title={`${label} theme`}
          onClick={() => onSetMode(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
