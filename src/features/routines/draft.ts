import Dexie, { type Table } from 'dexie'
import type { RoutineInput } from '../../types/training'

export interface RoutineDraft {
  key: string
  uid: string
  recordId: string
  expectedRevision: number | undefined
  input: RoutineInput
  savedInput: string | null
  savedAt: number
}

class RoutineDatabase extends Dexie {
  drafts!: Table<RoutineDraft, string>

  constructor() {
    super('muscle-memory-routine-drafts')
    this.version(1).stores({ drafts: '&key, uid, savedAt' })
  }
}

const database = new RoutineDatabase()
export function readRoutineDraft(uid: string, routeKey: string) {
  return database.drafts.get(`${uid}:${routeKey}`)
}
export async function saveRoutineDraft(draft: RoutineDraft): Promise<void> {
  await database.drafts.put(structuredClone(draft))
}
export async function clearRoutineDraft(uid: string, routeKey: string): Promise<void> {
  await database.drafts.delete(`${uid}:${routeKey}`)
}
export async function clearAllRoutineDrafts(): Promise<void> {
  await database.drafts.clear()
}
