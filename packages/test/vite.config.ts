import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'
import mcResourcesPlugin from '@hato810424/mc-resources-plugin/vite';

export default defineConfig({
  plugins: [
    react(),
    mcResourcesPlugin({
      resourcePackPath: './assets/resource-pack',
      mcVersion: '1.18.2',
      outputPath: './src/mcpacks',
      startUpRenderCacheRefresh: true,
    })
  ],
});
