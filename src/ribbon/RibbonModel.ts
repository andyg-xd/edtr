import type { Command, EditorState } from 'prosemirror-state';

/** Values collected by the InsertPopover for link/image controls. */
export interface PopoverValues {
  text: string;
  url: string;
  /** Set for local-file image inserts: the WebView-loadable display URL. */
  displaySrc?: string;
}

export type RibbonAction =
  | { kind: 'command'; run: Command }
  | {
      kind: 'popover';
      popover: 'link' | 'image';
      /** Build the command to run from the popover's collected values. */
      buildCommand: (values: PopoverValues) => Command;
      /** If present and the control isActive, a click runs this instead of opening the popover. */
      whenActiveRun?: Command;
    }
  | {
      kind: 'dropdown';
      options: { label: string; value: string }[];
      getValue: (state: EditorState) => string;
      run: (value: string) => Command;
    }
  | {
      kind: 'sizePicker';
      /** Build the insert command from the chosen dimensions. */
      buildCommand: (rows: number, cols: number) => Command;
    };

/** Which cluster a control belongs to. Dividers are drawn between groups. */
export type RibbonGroup = 'inline' | 'insert' | 'block' | 'structure';

export interface RibbonControl {
  id: string;
  /** Visible glyph / short text shown in the button. */
  label: string;
  /** Full accessible name. */
  ariaLabel: string;
  /** Cluster this control belongs to; controls are rendered in group order. */
  group: RibbonGroup;
  /** Display form of the keyboard shortcut, e.g. '⌘B'. Shown in the tooltip. */
  shortcut?: string;
  isActive: (state: EditorState) => boolean;
  isEnabled: (state: EditorState) => boolean;
  action: RibbonAction;
}
