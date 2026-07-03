import type { RibbonControl } from './RibbonModel';
import { htmlSchema } from '../views/htmlSchema';
import {
  markActive,
  toggleStrong, toggleEm, toggleUnderline, toggleStrike, toggleCode,
  canLink, applyLink, removeLink,
} from '../commands/htmlInlineCommands';

const { strong, em, underline, strike, code, link } = htmlSchema.marks;

export const htmlRibbon: RibbonControl[] = [
  { id: 'bold', label: 'B', ariaLabel: 'Bold',
    isActive: (s) => markActive(s, strong), isEnabled: (s) => toggleStrong(s),
    action: { kind: 'command', run: toggleStrong } },
  { id: 'italic', label: 'I', ariaLabel: 'Italic',
    isActive: (s) => markActive(s, em), isEnabled: (s) => toggleEm(s),
    action: { kind: 'command', run: toggleEm } },
  { id: 'underline', label: 'U', ariaLabel: 'Underline',
    isActive: (s) => markActive(s, underline), isEnabled: (s) => toggleUnderline(s),
    action: { kind: 'command', run: toggleUnderline } },
  { id: 'strike', label: 'S', ariaLabel: 'Strikethrough',
    isActive: (s) => markActive(s, strike), isEnabled: (s) => toggleStrike(s),
    action: { kind: 'command', run: toggleStrike } },
  { id: 'code', label: '</>', ariaLabel: 'Inline code',
    isActive: (s) => markActive(s, code), isEnabled: (s) => toggleCode(s),
    action: { kind: 'command', run: toggleCode } },
  { id: 'link', label: '\u{1F517}', ariaLabel: 'Link',
    isActive: (s) => markActive(s, link), isEnabled: (s) => canLink(s),
    action: {
      kind: 'popover', popover: 'link',
      buildCommand: ({ text, url }) => applyLink(url, text),
      whenActiveRun: removeLink,
    } },
];
