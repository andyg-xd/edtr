import type { RibbonControl } from './RibbonModel';
import { liveSchema } from '../views/liveSchema';
import {
  markActive, canInsert,
  toggleStrong, toggleEm, toggleStrike, toggleCode,
  canLink, applyLink, removeLink, insertImage,
} from '../commands/markdownInlineCommands';

const { strong, em, strikethrough, code, link } = liveSchema.marks;
const { image } = liveSchema.nodes;

export const markdownRibbon: RibbonControl[] = [
  {
    id: 'bold', label: 'B', ariaLabel: 'Bold',
    isActive: (s) => markActive(s, strong),
    isEnabled: (s) => toggleStrong(s),
    action: { kind: 'command', run: toggleStrong },
  },
  {
    id: 'italic', label: 'I', ariaLabel: 'Italic',
    isActive: (s) => markActive(s, em),
    isEnabled: (s) => toggleEm(s),
    action: { kind: 'command', run: toggleEm },
  },
  {
    id: 'strike', label: 'S', ariaLabel: 'Strikethrough',
    isActive: (s) => markActive(s, strikethrough),
    isEnabled: (s) => toggleStrike(s),
    action: { kind: 'command', run: toggleStrike },
  },
  {
    id: 'code', label: '</>', ariaLabel: 'Inline code',
    isActive: (s) => markActive(s, code),
    isEnabled: (s) => toggleCode(s),
    action: { kind: 'command', run: toggleCode },
  },
  {
    id: 'link', label: '\u{1F517}', ariaLabel: 'Link',
    isActive: (s) => markActive(s, link),
    isEnabled: (s) => canLink(s),
    action: {
      kind: 'popover', popover: 'link',
      buildCommand: ({ text, url }) => applyLink(url, text),
      whenActiveRun: removeLink,
    },
  },
  {
    id: 'image', label: '\u{1F5BC}', ariaLabel: 'Image',
    isActive: () => false,
    isEnabled: (s) => canInsert(s, image),
    action: {
      kind: 'popover', popover: 'image',
      buildCommand: ({ text, url }) => insertImage(url, text),
    },
  },
];
