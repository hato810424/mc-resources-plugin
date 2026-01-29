import type { Compiler, WebpackPluginInstance } from 'webpack';
import type Server from 'webpack-dev-server';
import type { Middleware, Configuration as DevServerConfiguration } from 'webpack-dev-server';
import type { PluginOptions } from '../types';
import { McResourcesCore } from './core';

class McResourcesPlugin implements WebpackPluginInstance {
  private readonly core: McResourcesCore;
  private isGenerated: boolean;
  private isBuild: boolean;
  private isPreview: boolean;
  private outDir: string | undefined;
  private buildProcessed: boolean = false;

  constructor(options: PluginOptions) {
    this.isGenerated = false;
    this.core = new McResourcesCore(options);
    
    this.isBuild = false;
    this.isPreview = false;
  }
  
  apply(compiler: Compiler): void {
    // 画像ローダーを自動的に追加
    const ensureImageLoaderRule = () => {
      if (!compiler.options.module) {
        compiler.options.module = { rules: [] } as any;
      }
      if (!compiler.options.module.rules) {
        compiler.options.module.rules = [];
      }

      // 既に画像ローダーが設定されているか確認
      const hasImageLoader = compiler.options.module.rules.some(rule => {
        if (typeof rule === 'object' && rule !== null && 'test' in rule) {
          const testRegex = rule.test;
          if (testRegex instanceof RegExp) {
            return testRegex.test('.png') || testRegex.test('.jpg');
          }
        }
        return false;
      });

      // 設定されていなければ追加
      if (!hasImageLoader) {
        compiler.options.module.rules.push({
          test: /\.(png|jpg|jpeg|gif|webp)$/i,
          type: 'asset/resource',
        });
      }
    };

    ensureImageLoaderRule();

    // Production モードかどうかの判定
    const isProduction = compiler.options.mode === 'production';

    // build か serve(dev-server) かの判定
    // webpack-dev-server が動いている時は WEBPACK_SERVE 環境変数が true になる
    const isServe = !!process.env.WEBPACK_SERVE;
    this.isBuild = !isServe;
    this.isPreview = (isProduction && isServe);
    
    // output ディレクトリを取得
    this.outDir = compiler.options.output.path;

    compiler.hooks.emit.tap('McResourcesPlugin', async (compilation) => {
      if (!this.isBuild && !this.isPreview) {
        this.core.devServerStart()
      }
    });

    compiler.hooks.beforeCompile.tapAsync('McResourcesPlugin', async (compilation, callback) => {
      if (this.isBuild && !this.buildProcessed) {
        this.buildProcessed = true;
        await this.core.getAssetsInBuildMode();
        
        await this.core.build({
          distDir: this.outDir!,
        })
      }

      callback();
    });

    if (compiler.options.devServer) {
      // devServerがない場合は初期化
      if (!compiler.options.devServer) {
        compiler.options.devServer = {};
      }
      
      const devServerConfig: DevServerConfiguration = compiler.options.devServer || {};
      // setupMiddlewares の引数と戻り値に型を適用
      devServerConfig.setupMiddlewares = (
        middlewares: Middleware[],
        devServer: Server
      ): Middleware[] => {
        
        if (!devServer.app) {
          throw new Error('webpack-dev-server app is not defined');
        }

        // 3. Expressのメソッド(get, postなど)が型安全に利用可能
        devServer.app.get('/@hato810424:mc-resources-plugin/*', (req, res, next) => {
          this.core.devServerMiddleware({
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
            isBuild: this.isBuild,
            isGenerated: this.isGenerated,
          });
        });

        return middlewares;
      };

      // 最終的に compiler.options に戻す
      compiler.options.devServer = devServerConfig;
    }
  }
}

export default McResourcesPlugin;
