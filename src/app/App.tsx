import { OnboardingForm } from '../features/onboarding/components/OnboardingForm'
import styles from './App.module.css'
import { ErrorBoundary } from './ErrorBoundary'
import { ErrorFallback } from './ErrorFallback'

export function App() {
  return (
    <main className={styles.page}>
      {/* Static, as in the mockup: this app implements only the first onboarding step. */}
      <p className={styles.step}>Step 1 of 5</p>
      {/* Around the form only: the page and its step indicator stay if the form crashes. */}
      <ErrorBoundary fallback={<ErrorFallback />}>
        <OnboardingForm />
      </ErrorBoundary>
    </main>
  )
}
