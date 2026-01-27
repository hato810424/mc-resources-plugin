import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'
import mcResourcesPlugin from '@hato810424/mc-resources-plugin/vite';

export default defineConfig({
  plugins: [
    react(),
    mcResourcesPlugin({
      resourcePackPath: './assets/resource-pack',
      outputPath: './src/mcpacks',
      startUpCacheRefresh: true,
    })
  ],
});
