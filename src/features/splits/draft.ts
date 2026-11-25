import Dexie, { type Table } from 'dexie'
import type { SplitInput } from '../../types/training'
export interface SplitDraft { key: string; uid: string; id: string; sourceId: string | null; expectedRevision?: number; input: SplitInput; savedAt: number }
class SplitDraftDatabase extends Dexie {
  drafts!: Table<SplitDraft, string>
  constructor() { super('muscle-memory-split-drafts'); this.version(1).stores({drafts: 'key, uid'}) }
}
const database = new SplitDraftDatabase()
export const saveSplitDraft = (draft: SplitDraft) => database.drafts.put(draft)
export const readSplitDraft = (uid: string, id: string) => database.drafts.get(`${uid}:${id}`)
export const clearSplitDraft = (uid: string, id: string) => database.drafts.delete(`${uid}:${id}`)
export const clearAllSplitDrafts = () => database.drafts.clear()
