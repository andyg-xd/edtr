import type { ReactNode } from 'react';
import { ModeControls } from '../writingmodes/ModeControls';
import { ExportButton } from '../export/ExportButton';
import type { WritingMode, WritingModes } from '../settings/writingModes';

interface DocumentToolbarProps {
  /** Format-specific formatting controls. Null in Code view (spec §3). */
  formatting: ReactNode;
  modes: WritingModes;
  onSetMode: (mode: WritingMode, on: boolean) => void;
  onExport: (kind: 'html' | 'pdf') => void;
  /** False for plaintext — nothing to build an export from. */
  canExport: boolean;
}

/**
 * The persistent toolbar row (6c-iii, D9).
 *
 * Two zones: formatting on the left, which only Live view fills, and document
 * actions on the right, which are present in EVERY view. This is one
 * component rendered by all three of `DocumentView`'s branches on purpose —
 * three copies of the actions zone is the shape that has produced this
 * codebase's recurring "two things that must agree, and drift" defects (two
 * mode-name lists that drifted, a menu command with no listener).
 *
 * Why the actions zone can't just live in the ribbon: `RibbonView` renders
 * only when Live view is showing (`DocumentView.tsx`'s three branches), so
 * Code view has no ribbon at all. Typewriter and Focus both genuinely work in
 * Code view (`codeTypewriter.ts`, `codeFocus.ts`) — putting the toggles in the
 * ribbon would strand them exactly where they work.
 */
export function DocumentToolbar(props: DocumentToolbarProps) {
  return (
    <div className="doc-toolbar">
      <div className="doc-toolbar-formatting">{props.formatting}</div>
      <div className="doc-toolbar-actions">
        <ModeControls modes={props.modes} onSetMode={props.onSetMode} />
        <ExportButton onExport={props.onExport} disabled={!props.canExport} />
      </div>
    </div>
  );
}
