import { defineConfig } from 'vite'

// The dev host lives in src/dev; the engine + ai + ui are consumed as source from there.
export default defineConfig({
  root: 'src/dev',
  base: './',
  server: { port: 5181 },
  build: {
    outDir: '../../dist-dev',
    emptyOutDir: true,
  },
})

