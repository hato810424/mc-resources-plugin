import type { PluginOptions } from '../types';
import type { PluginOption } from 'vite';
import { rmSync } from 'fs';
import { join } from 'path';
import { McResourcesCore } from './core';

const mcResourcesPlugin = async (options: PluginOptions) => {
  let isGenerated = false;
  const core = new McResourcesCore(options);
  
  let isBuild = false;
  let isPreview = false;
  let outDir: string;
  let configResolvedDone = false;
  
  return {
    name: '@hato810424/mc-resources-plugin',

    configResolved: async (config) => {
      if (configResolvedDone) return;
      configResolvedDone = true;

      // コマンドモードを先に設定
      if (config.command === 'build') {
        isBuild = true;
      }

      if (config.isProduction && config.command === 'serve') {
        isPreview = true;
      }

      if (!isBuild && !isPreview) {
        // dev モード
        // アセット取得をバックグラウンドで非同期実行
        core.getAssetsInDevMode();
      } else {
        // build / preview モード時：即座にアセット取得
        await core.getAssetsInBuildMode();
      }

      outDir = config.build.outDir;
    },

    buildStart: async function() {
      if (isPreview) {
        return;
      }

      // 起動時にキャッシュをクリア
      if (core.config.startUpRenderCacheRefresh) {
        rmSync(join(core.config.cacheDir!, 'renders'), { recursive: true, force: true });
      }

      if (isBuild) {
        await core.build({
          distDir: outDir,
        });
      }
    },


    // レンダリングが必要なアイテム
    configureServer: (server) => {

      if (!isBuild && !isPreview) {
        core.devServerStart();
      }
      
      server.middlewares.use(async (req, res, next) => {
        return await core.devServerMiddleware({
          next,
          req: {
            url: req.url,
            headers: req.headers,
          },
          res: {
            setStatus: (statusCode) => {
              res.statusCode = statusCode;
            },
            setHeader: (name, value) => {
              res.setHeader(name, value);
            },
            send: (body) => {
              res.end(body);
            },
          },
          isBuild,
          isGenerated,
        });
      });
    },
  } satisfies PluginOption;
};

export default mcResourcesPlugin;
