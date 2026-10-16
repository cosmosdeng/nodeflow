import type {
  FlowNode,
  FlowEdge,
  GraphSnapshot,
  GraphDocument,
  ViewportState,
  Artifact,
  FlowNodeData,
  FlowEdgeData,
  EdgeStyle,
  ThemeMode,
  Annotation,
  Stage,
  Participant,
  Organization,
  ParticipantOrderMode,
} from '../../types';
import type { FlowStore } from '../types';
import type { SliceDeps } from './deps';
import { makeSnapshot, restoreSnapshotFields } from '../historyHelpers';

export function createHistorySlice({ set, get }: SliceDeps): Partial<FlowStore> {
  return {
    markHistory: () =>
      set((s) => ({
        past: [...s.past.slice(-99), makeSnapshot(s)],
        future: [],
      })),

    undo: () => {
      if (get().allLocked) return;
      set((s) => {
        if (!s.past.length) return s;
        const prev = s.past[s.past.length - 1];
        return {
          past: s.past.slice(0, -1),
          future: [...s.future, makeSnapshot(s)],
          ...restoreSnapshotFields(s, prev),
        };
      });
    },

    redo: () => {
      if (get().allLocked) return;
      set((s) => {
        if (!s.future.length) return s;
        const next = s.future[s.future.length - 1];
        return {
          future: s.future.slice(0, -1),
          past: [...s.past, makeSnapshot(s)],
          ...restoreSnapshotFields(s, next),
        };
      });
    },

    jumpTo: (index) => {
      if (get().allLocked) return;
      set((s) => {
        if (index < 0 || index >= s.past.length) return s;
        const target = s.past[index];
        return {
          past: s.past.slice(0, index),
          future: [...s.future, makeSnapshot(s)],
          ...restoreSnapshotFields(s, target),
        };
      });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

  };
}
