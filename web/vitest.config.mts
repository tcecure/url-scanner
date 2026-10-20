import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

// The app imports through the `@/` alias tsconfig defines; tests load the same
// modules, so the alias has to exist here too.
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
});
