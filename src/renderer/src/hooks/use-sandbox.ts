import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

type Area = 'files' | 'mail' | 'finance'

/** Loads sandbox data and reloads it whenever the main process reports that area changed. */
export function useSandboxData<T>(area: Area, load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(
    () =>
      api.on('sandbox:changed', (c) => {
        if (c.area === area || c.area === 'all') setVersion((v) => v + 1)
      }),
    [area],
  )

  useEffect(() => {
    let cancelled = false
    load().then(
      (d) => {
        if (!cancelled) {
          setData(d)
          setError(null)
        }
      },
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps])

  return { data, error, version }
}
