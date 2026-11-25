import { useRef, useState } from 'react'
import { useAuth } from '../../services/auth/AuthProvider'

export function useExerciseFavorites() {
  const { account, saveProfile } = useAuth()
  const accountRef = useRef(account)
  accountRef.current = account
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isFavorite = (name: string) =>
    Boolean(
      account?.preferences.favoriteExercises.some(
        (value) => value.toLocaleLowerCase() === name.toLocaleLowerCase(),
      ),
    )
  async function toggleFavorite(name: string) {
    const current = accountRef.current
    if (!current || busyRef.current) return
    setError('')
    const previous = current.preferences.favoriteExercises
    const exists = previous.some((value) => value.toLocaleLowerCase() === name.toLocaleLowerCase())
    if (!exists && previous.length >= 10) {
      setError('You can save up to 10 favorite exercises. Remove a favorite before adding another.')
      return
    }
    if (
      !exists &&
      current.preferences.excludedExercises.some(
        (value) => value.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      setError(
        'This exercise is excluded in your preferences. Remove it from your excluded exercises before adding it as a favorite.',
      )
      return
    }
    busyRef.current = true
    setBusy(true)
    try {
      await saveProfile({
        displayName: current.profile.displayName,
        onboardingCompleted: current.profile.onboardingCompleted,
        preferences: {
          ...current.preferences,
          favoriteExercises: exists
            ? previous.filter((value) => value.toLocaleLowerCase() !== name.toLocaleLowerCase())
            : [...previous, name],
        },
      })
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Your favorites could not be saved. Please try again.',
      )
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  return { isFavorite, toggleFavorite, busy: busy || Boolean(account?.hasPendingWrites), error }
}
