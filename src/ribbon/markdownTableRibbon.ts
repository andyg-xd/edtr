import type { RibbonControl } from './RibbonModel';
import {
  isInTable,
  addRow, canAddRowAbove,
  deleteRow, canDeleteRow,
  addColumn, deleteColumn, canDeleteColumn,
  setColumnAlign, getColumnAlign,
} from '../commands/markdownTableCommands';

export const markdownTableRibbon: RibbonControl[] = [
  { id: 'rowAbove', label: '+Row↑', ariaLabel: 'Insert row above', group: 'structure',
    isActive: () => false, isEnabled: (s) => canAddRowAbove(s),
    action: { kind: 'command', run: addRow('above') } },
  { id: 'rowBelow', label: '+Row↓', ariaLabel: 'Insert row below', group: 'structure',
    isActive: () => false, isEnabled: (s) => isInTable(s),
    action: { kind: 'command', run: addRow('below') } },
  { id: 'colLeft', label: '+Col←', ariaLabel: 'Insert column left', group: 'structure',
    isActive: () => false, isEnabled: (s) => isInTable(s),
    action: { kind: 'command', run: addColumn('left') } },
  { id: 'colRight', label: '+Col→', ariaLabel: 'Insert column right', group: 'structure',
    isActive: () => false, isEnabled: (s) => isInTable(s),
    action: { kind: 'command', run: addColumn('right') } },
  { id: 'delRow', label: '✕Row', ariaLabel: 'Delete row', group: 'structure',
    isActive: () => false, isEnabled: (s) => canDeleteRow(s),
    action: { kind: 'command', run: deleteRow } },
  { id: 'delCol', label: '✕Col', ariaLabel: 'Delete column', group: 'structure',
    isActive: () => false, isEnabled: (s) => canDeleteColumn(s),
    action: { kind: 'command', run: deleteColumn } },
  {
    id: 'columnAlign', label: 'Align', ariaLabel: 'Column alignment', group: 'block',
    isActive: () => false, isEnabled: (s) => isInTable(s),
    action: {
      kind: 'dropdown',
      options: [
        { label: 'Default', value: '' },
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
      getValue: (s) => getColumnAlign(s) ?? '',
      run: (v) => setColumnAlign(v === '' ? null : (v as 'left' | 'center' | 'right')),
    },
  },
];
