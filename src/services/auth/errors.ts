export function readableAuthError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'The email or password is incorrect.'
    case 'auth/email-already-in-use':
      return 'An account already uses this email. Try signing in.'
    case 'auth/invalid-email':
      return 'Enter a valid email address.'
    case 'auth/weak-password':
      return 'Choose a password with at least 12 characters.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a little before trying again.'
    case 'auth/network-request-failed':
      return 'A connection is needed for this action. Check your internet connection.'
    case 'auth/operation-not-allowed':
      return 'Email and password sign-in is not enabled for this Firebase project.'
    case 'permission-denied':
      return 'Your account does not currently have permission to save this data. Check access and try again.'
    case 'unavailable':
      return 'The service is unavailable. Your cached data remains on this device.'
    case 'resource-exhausted':
      return 'The service has reached its usage limit. Try again later.'
    case 'failed-precondition':
      return 'Close other Muscle Memory tabs and try again.'
    default:
      return 'Something prevented this action. Try again, or check your connection and account access.'
  }
}
