import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'vite': 'src/plugin/vite.ts'
  },
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
  platform: 'node',
})
