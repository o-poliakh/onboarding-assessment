import { useId, type ComponentProps } from 'react'
import styles from './FormField.module.css'

type FormFieldProps = Omit<
  ComponentProps<'input'>,
  'id' | 'className' | 'aria-describedby' | 'aria-invalid'
> & {
  label: string
  /** Validation message; marks the field invalid when present. */
  error?: string | undefined
}

/**
 * Text input with a persistent label and an error message linked via
 * `aria-describedby`. In React 19 `ref` is a regular prop, so
 * `{...register('field')}` from React Hook Form can be spread directly.
 */
export function FormField({ label, error, ...inputProps }: FormFieldProps) {
  const id = useId()
  const errorId = `${id}-error`

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>

      <input
        {...inputProps}
        id={id}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />

      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
