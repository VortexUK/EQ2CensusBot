// Test setup — runs once before every Vitest worker spins up.
//
// `@testing-library/jest-dom` augments Vitest's expect with DOM matchers
// like `toBeInTheDocument` / `toHaveTextContent`. Importing for the
// side-effect is enough.
import '@testing-library/jest-dom/vitest'
