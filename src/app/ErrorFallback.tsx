import styles from './ErrorFallback.module.css'

/**
 * Shown by the error boundary in place of the form; `role="alert"` announces it.
 * A reload rather than a re-render: a render bug would fail again on the same code,
 * while a reload also picks up a fixed deployment.
 */
export function ErrorFallback() {
  return (
    <div className={styles.card} role="alert">
      <h1 className={styles.title}>Something went wrong</h1>
      <p className={styles.text}>The form could not be displayed. Please reload the page.</p>
      <button type="button" className={styles.reload} onClick={() => window.location.reload()}>
        Reload page
      </button>
    </div>
  )
}
