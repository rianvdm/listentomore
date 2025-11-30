// Global test setup
import { vi } from 'vitest';

// Mock fetch globally
global.fetch = vi.fn();

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});
