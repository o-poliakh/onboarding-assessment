import { useEffect } from 'react'

/**
 * Prefixes the page title with "Error: " while `hasErrors` is true, so a screen reader
 * announces the problem as early as possible (GOV.UK pattern). The original title is
 * restored when the errors are gone or the component unmounts.
 */
export function useErrorTitlePrefix(hasErrors: boolean) {
  useEffect(() => {
    if (!hasErrors) {
      return
    }
    const originalTitle = document.title
    document.title = `Error: ${originalTitle}`

    return () => {
      document.title = originalTitle
    }
  }, [hasErrors])
}
