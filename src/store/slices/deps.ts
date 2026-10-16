import type { FlowStore } from '../types';

export type StoreSet = (partial: Partial<FlowStore> | ((s: FlowStore) => Partial<FlowStore>)) => void;
export type StoreGet = () => FlowStore;
export interface SliceDeps {
  set: StoreSet;
  get: StoreGet;
}
