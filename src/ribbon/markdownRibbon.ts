import type { RibbonControl } from './RibbonModel';
import { liveSchema } from '../views/liveSchema';
import {
  markActive, canInsert,
  toggleStrong, toggleEm, toggleStrike, toggleCode,
  canLink, applyLink, removeLink, insertImage,
} from '../commands/markdownInlineCommands';
import {
  currentBlockType, canTransform,
  setHeading, setParagraph, toggleCodeBlock,
  toggleBlockquote, toggleBulletList, toggleOrderedList, toggleTaskList,
} from '../commands/markdownBlockCommands';
import { insertHorizontalRule } from '../commands/markdownStructureCommands';
import { insertTable, canInsertTable } from '../commands/markdownTableCommands';

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
  {
    id: 'heading', label: 'Paragraph', ariaLabel: 'Text style',
    isActive: () => false,
    isEnabled: (s) => canTransform(s),
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
  { id: 'codeBlock', label: '{ }', ariaLabel: 'Code block',
    isActive: (s) => currentBlockType(s) === 'codeBlock', isEnabled: (s) => canTransform(s),
    action: { kind: 'command', run: toggleCodeBlock } },
  { id: 'blockquote', label: '❝', ariaLabel: 'Blockquote',
    isActive: (s) => currentBlockType(s) === 'blockquote', isEnabled: (s) => canTransform(s),
    action: { kind: 'command', run: toggleBlockquote } },
  { id: 'bulletList', label: '•', ariaLabel: 'Bullet list',
    isActive: (s) => currentBlockType(s) === 'bulletList', isEnabled: (s) => canTransform(s),
    action: { kind: 'command', run: toggleBulletList } },
  { id: 'orderedList', label: '1.', ariaLabel: 'Numbered list',
    isActive: (s) => currentBlockType(s) === 'orderedList', isEnabled: (s) => canTransform(s),
    action: { kind: 'command', run: toggleOrderedList } },
  { id: 'taskList', label: '☑', ariaLabel: 'Task list',
    isActive: (s) => currentBlockType(s) === 'taskList', isEnabled: (s) => canTransform(s),
    action: { kind: 'command', run: toggleTaskList } },
  { id: 'horizontalRule', label: '―', ariaLabel: 'Horizontal rule',
    isActive: () => false, isEnabled: (s) => insertHorizontalRule(s),
    action: { kind: 'command', run: insertHorizontalRule } },
  { id: 'insertTable', label: '⊞', ariaLabel: 'Insert table',
    isActive: () => false, isEnabled: (s) => canInsertTable(s),
    action: { kind: 'sizePicker', buildCommand: (rows, cols) => insertTable(rows, cols) } },
];
