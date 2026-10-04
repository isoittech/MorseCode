import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 7631,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:17631' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            { name: 'ag-ui', test: /\/node_modules\/@ag-ui\// },
            { name: 'copilot', test: /\/node_modules\/@copilotkit\// },
            { name: 'validation', test: /\/node_modules\/zod\// },
          ],
        },
      },
    },
  },
});
