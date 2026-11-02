import { useCallback, useState } from 'react'

/** A boolean kept in localStorage; works (unsaved) when storage is unavailable. */
export function useStored(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const s = localStorage.getItem(key)
      return s === null ? initial : s === '1'
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (v: boolean) => {
      setValue(v)
      try {
        localStorage.setItem(key, v ? '1' : '0')
      } catch {
        // storage unavailable
      }
    },
    [key],
  )
  return [value, set]
}
