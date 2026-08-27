import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Deliberately NARROW. This is not a style linter and must not become one.
 *
 * It exists for one bug class, found the expensive way (6c-iv B2, 2026-08-26):
 * `useImperativeHandle` omitted three values its closure captured, so the
 * handle was pinned to the first render and an outline click silently did
 * nothing. 1228 tests could not see it, and four correctly-written sibling
 * memos sat two hundred lines away in the same file.
 *
 * The repo also carried 16 `eslint-disable-next-line react-hooks/exhaustive-deps`
 * comments while having no ESLint at all — suppressions for a rule that had
 * never run, and therefore never verified against anything.
 *
 * `reportUnusedDisableDirectives` is on for exactly that reason: a suppression
 * that suppresses nothing is noise pretending to be a decision, and it makes
 * the next reader think a real finding was considered and accepted.
 *
 * Formatting, import order, naming and the rest stay out. `tsc` and code
 * review already cover what they cover, and a broad ruleset dropped onto 252
 * files would bury the one signal this is here to surface.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'src-tauri/**', 'node_modules/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [tseslint.configs.base],
    plugins: { 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // A closure that captures render values must declare them, or it silently
      // freezes at whichever render built it. This is B2 exactly.
      'react-hooks/exhaustive-deps': 'error',
      // Conditional or nested hook calls. Near-zero false positives, and the
      // failure mode is state landing on the wrong hook.
      'react-hooks/rules-of-hooks': 'error',
    },
  },
);
