import type { RibbonControl } from './RibbonModel';
import { htmlSchema } from '../views/htmlSchema';
import {
  markActive, canInsert,
  toggleStrong, toggleEm, toggleUnderline, toggleStrike, toggleCode,
  canLink, applyLink, removeLink, insertImage,
} from '../commands/htmlInlineCommands';
import {
  currentBlockType, canTransform,
  setHeading, setParagraph, toggleCodeBlock,
} from '../commands/htmlBlockCommands';

const { strong, em, underline, strike, code, link } = htmlSchema.marks;
const { image } = htmlSchema.nodes;

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
  {
    id: 'image', label: '\u{1F5BC}', ariaLabel: 'Image',
    isActive: () => false, isEnabled: (s) => canInsert(s, image),
    action: {
      kind: 'popover', popover: 'image',
      buildCommand: ({ url, text, displaySrc }) => insertImage(url, text || null, displaySrc ?? null),
    },
  },
  {
    id: 'heading', label: 'Paragraph', ariaLabel: 'Text style',
    isActive: () => false, isEnabled: (s) => canTransform(s),
    action: {
      kind: 'dropdown',
      options: [
        { label: 'Paragraph', value: 'paragraph' },
        { label: 'Heading 1', value: 'h1' }, { label: 'Heading 2', value: 'h2' },
        { label: 'Heading 3', value: 'h3' }, { label: 'Heading 4', value: 'h4' },
        { label: 'Heading 5', value: 'h5' }, { label: 'Heading 6', value: 'h6' },
      ],
      getValue: (s) => { const t = currentBlockType(s); return t.startsWith('h') || t === 'paragraph' ? t : 'paragraph'; },
      run: (v) => (v === 'paragraph' ? setParagraph : setHeading(Number(v[1]))),
    },
  },
  {
    id: 'codeBlock', label: '{ }', ariaLabel: 'Code block',
    isActive: (s) => currentBlockType(s) === 'codeBlock', isEnabled: (s) => canTransform(s),
    action: { kind: 'command', run: toggleCodeBlock },
  },
];
