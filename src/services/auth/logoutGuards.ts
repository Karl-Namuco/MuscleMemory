type LogoutGuard = () => void | Promise<void>
const guards = new Map<string, Set<LogoutGuard>>()

/** Private features register a guard before Firebase persistence can be cleared. */
export function registerLogoutGuard(uid: string, guard: LogoutGuard): () => void {
  const userGuards = guards.get(uid) ?? new Set<LogoutGuard>()
  userGuards.add(guard)
  guards.set(uid, userGuards)
  return () => {
    userGuards.delete(guard)
    if (userGuards.size === 0) guards.delete(uid)
  }
}

export async function assertCanLogout(uid: string): Promise<void> {
  for (const guard of guards.get(uid) ?? []) await guard()
}
