// Global test setup
import { vi, beforeEach } from 'vitest';

// Mock fetch globally
globalThis.fetch = vi.fn() as typeof fetch;

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});
