import type { LoadContext, Plugin, PluginModule } from '@docusaurus/types';
import type { PluginOptions } from '../types';
import { McResourcesCore } from './core';

export default function docusaurusPlugin(
  pluginOptions: PluginOptions
): PluginModule<void> {
  return async function pluginInstance(
    context: LoadContext
  ): Promise<Plugin<void>> {
    const core = new McResourcesCore(pluginOptions);
    let isGenerated = false;
    
    // Detect build mode early (before returning plugin)
    const isBuild = process.env.NODE_ENV === 'production' || context.siteConfig.customFields?.buildMode === true;
    
    // Execute build process immediately before Docusaurus build starts
    if (isBuild) {
      await core.getAssetsInBuildMode();
      await core.build({
        distDir: context.outDir,
      });
    } else {
      // dev mode: get assets in background
      core.getAssetsInDevMode();
    }

    return {
      name: '@hato810424/mc-resources-plugin-docusaurus',

      async loadContent() {
        // Content already loaded during plugin initialization
        // This is a placeholder for any additional content loading
      },

      configureWebpack(config, isServer, utils) {
        if (isServer) {
          return {};
        }

        // Ensure devServer exists
        if (!config.devServer) {
          config.devServer = {};
        }

        // Store the original setupMiddlewares if it exists
        const originalSetupMiddlewares = config.devServer.setupMiddlewares;

        return {
          devServer: {
            setupMiddlewares: (middlewares, devServer) => {
              if (!devServer.app) {
                throw new Error('webpack-dev-server app is not defined');
              }

              // Execute original setupMiddlewares if it exists
              if (originalSetupMiddlewares) {
                middlewares = originalSetupMiddlewares(middlewares, devServer);
              }

              // Start dev server
              if (!isBuild) {
                core.devServerStart();
              }

              // Register middleware
              devServer.app.get('/@hato810424:mc-resources-plugin/*', (req, res, next) => {
                core.devServerMiddleware({
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

              return middlewares;
            },
          },
        };
      },
    };
  };
}
