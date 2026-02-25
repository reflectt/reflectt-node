import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/global-teardown.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      // Prevent tests from ever defaulting to production data dir
      REFLECTT_TEST_MODE: 'true',
    },
  },
})
