// Registers @testing-library/jest-dom matchers (toBeInTheDocument, toBeEnabled, ...)
// globally for both jsdom and node test environments. Safe in node-environment
// suites too: it only extends `expect`, it doesn't touch the DOM itself.
import '@testing-library/jest-dom/vitest';
