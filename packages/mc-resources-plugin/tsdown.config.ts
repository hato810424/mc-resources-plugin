import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'vite': 'src/plugin/vite.ts',
    'webpack': 'src/plugin/webpack.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  outDir: 'dist',
  clean: true,
  platform: 'node',
})
