import { PluginOptionsSchema, type PluginOptions } from '../types';
import { getAllImages, initializeOutputDirectory, writeFiles } from '../filesystem';
import { generateGetResourcePackCode, generateTypeDefinitions } from '../codeGenerator';
import { scanSourceCode } from '../codeScanner';
import type { PluginOption } from 'vite';
import defaultLogger from '../logger';
import { existsSync, rmSync } from 'fs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createResourcePack, type MinecraftResourcePack } from '../render/ResourcePack';
import { createVersionManager, type MinecraftVersionManager } from '../mojang/minecraftVersionManager';
import { createItemManager, type ItemManager } from '../mojang/itemManager';
import { CACHE_DIR } from '../cache';

// グローバルインスタンス
let globalVersionManager: MinecraftVersionManager | undefined = undefined;
let globalItemManager: ItemManager | undefined = undefined;

export function getVersionManager(): MinecraftVersionManager {
  if (!globalVersionManager) {
    throw new Error('VersionManager is not initialized');
  }
  return globalVersionManager;
}

export function getItemManager(): ItemManager {
  if (!globalItemManager) {
    throw new Error('ItemManager is not initialized');
  }
  return globalItemManager;
}

const mcResourcesPlugin = async (options: PluginOptions) => {
  let isGenerated = false;
  const validatedOptions = PluginOptionsSchema.parse(options);
  const {
    mcVersion,
    resourcePackPath,
    outputPath = './mcpacks',
    emptyOutDir = false,
    include = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    exclude = [],
    cacheDir = CACHE_DIR!,
    startUpRenderCacheRefresh = false,
  } = validatedOptions;

  const renderingTasks = new Map<string, Promise<Buffer>>();
  let fileGenerationPromise: Promise<void> | null = null;
  
  /**
   * ファイル生成関数（遅延生成対応）
   */
  const generateFiles = async ({
    usedIds = undefined,
    isBase64 = false,
    ensureItems3d = false,
  }: {
    usedIds?: Set<string>;
    isBase64?: boolean;
    ensureItems3d?: boolean;
  } = {}): Promise<void> => {
    if (isGenerated) return; // 既に生成済みの場合スキップ

    // 既にファイル生成中の場合は、その完了を待つ
    if (fileGenerationPromise) {
      return fileGenerationPromise;
    }

    fileGenerationPromise = (async () => {
      // dev モード時かつ3Dアイテムを確実に必要な場合、先に取得
      if (ensureItems3d && !isBuild && globalItemManager) {
        try {
          await globalItemManager.get3DItems(mcVersion);
        } catch (err) {
          defaultLogger.warn(`Failed to fetch 3D items: ${err}`);
        }
      }

      const images = getAllImages(resourcePackPath);
      
      const jsCode = await generateGetResourcePackCode({ images, resourcePackPath, isBase64, usedIds, itemManager: globalItemManager, versionId: mcVersion });
      const tsCode = await generateTypeDefinitions({ images, usedIds, itemManager: globalItemManager, versionId: mcVersion });

      // 出力ディレクトリを初期化
      initializeOutputDirectory(outputPath, emptyOutDir);

      // ファイルを書き込む
      writeFiles(outputPath, jsCode, tsCode);

      const displayCount = usedIds ? usedIds.size : images.length;
      defaultLogger.info(`Generated with ${displayCount} images (found ${images.length} total)`);

      isGenerated = true;
    })();

    return fileGenerationPromise;
  };
  
  let isBuild = false;
  let isPreview = false;
  let resourcePack: MinecraftResourcePack | null = null;
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

      // グローバルインスタンスの初期化
      globalVersionManager = createVersionManager(cacheDir!);
      globalItemManager = createItemManager(globalVersionManager);

      if (!isBuild && !isPreview) {
        // dev モード時：軽量な初期化のみ
        // 重い処理（アセット取得、3Dアイテム検出）はバックグラウンドで遅延実行
        // 起動速度を最優先
        defaultLogger.info('Dev mode: Heavy initialization deferred to background');
        
        // アセット取得をバックグラウンドで非同期実行
        setTimeout(() => {
          globalVersionManager!.getAssets(mcVersion).catch(err => {
            defaultLogger.warn(`Failed to pre-fetch assets: ${err}`);
          });
        }, 500);

        // 3D アイテム取得をさらに遅延実行
        setTimeout(() => {
          globalItemManager!.get3DItems(mcVersion).catch(err => {
            defaultLogger.warn(`Failed to preload 3D items: ${err}`);
          });
        }, 2000);
      } else {
        // build / preview モード時：即座にアセット取得
        globalVersionManager.getAssets(mcVersion).catch(err => {
          defaultLogger.warn(`Failed to pre-fetch assets: ${err}`);
        });
      }

      outDir = config.build.outDir;
    },

    buildStart: async () => {
      if (isPreview) {
        return;
      }

      // 起動時にキャッシュをクリア
      if (startUpRenderCacheRefresh) {
        rmSync(join(cacheDir!, 'renders'), { recursive: true, force: true });
      }

      if (!isBuild) {
        // dev モード: ファイル生成を遅延化（初回アクセス時に実行）
        // buildStart では何もしない
        defaultLogger.info('Dev mode: File generation deferred to first access');
      } else {
        // build モード: 即座にファイル生成
        // ビルド開始時に、使用されているMinecraft IDをスキャン
        const root = process.cwd();
        const detectedIds = scanSourceCode(root, { include, exclude, outputPath, viteOutDir: outDir });
        await generateFiles({ usedIds: detectedIds.size > 0 ? detectedIds : undefined });
      }
    },

    // レンダリングが必要なアイテム
    configureServer: (server) => {
      // dev モード時：初回アクセス時にファイル生成をバックグラウンドで開始（ノンブロッキング）
      let fileGenerationStarted = false;
      
      server.middlewares.use(async (req, res, next) => {
        // dev モード時かつまだ生成していない場合、バックグラウンドで生成開始
        if (!isBuild && !isGenerated && !fileGenerationStarted) {
          fileGenerationStarted = true;
          defaultLogger.info('Starting file generation in background...');
          
          // ファイル生成をバックグラウンドで実行（await しない）
          generateFiles({ isBase64: true, ensureItems3d: true }).catch(err => {
            defaultLogger.warn(`Failed to generate files: ${err}`);
          });
        }

        // ミドルウェアは即座に次に進む（ブロッキングしない）
        if (!req.url?.startsWith('/@hato810424:mc-resources-plugin/minecraft:')) {
          next();
          return;
        }

        try {
          // URL パースしてクエリパラメータを取得
          const url = new URL(req.url!, `http://${req.headers.host}`);
          const minecraftId = url.pathname.replace('/@hato810424:mc-resources-plugin/minecraft:', '');
          
          if (!minecraftId) {
            res.statusCode = 400;
            res.end('Invalid minecraft ID');
            return;
          }

          // クエリパラメータから width, height, scale を取得
          const width = parseInt(url.searchParams.get('width') ?? '128', 10);
          const height = parseInt(url.searchParams.get('height') ?? String(width), 10);
          const scaleParam = url.searchParams.get('scale');
          const scale = scaleParam ? parseFloat(scaleParam) : undefined;

          // レスポンス送信関数
          const sendResponse = (imageBuffer: Buffer) => {
            res.setHeader('Content-Type', 'image/png');
            res.end(imageBuffer);
          };

          // キャッシュキーにサイズ情報を含める
          const cacheKey = `${minecraftId}_${width}x${height}_${scale ? scale : ''}.png`;
          const cacheFile = join(cacheDir!, 'renders', cacheKey);
          
          // 1. ファイルキャッシュを確認
          if (existsSync(cacheFile)) {
            const imageBuffer = readFileSync(cacheFile);
            sendResponse(imageBuffer);
            defaultLogger.info(`File cache hit: ${minecraftId}`);
            return;
          }

          // 2. 既にレンダリング中のタスクがあれば、それを待つ
          if (renderingTasks.has(minecraftId)) {
            defaultLogger.info(`Waiting for pending render: ${minecraftId}`);
            const imageBuffer = await renderingTasks.get(minecraftId)!;
            sendResponse(imageBuffer);
            return;
          }

          // 3. レンダリング処理を実行
          const renderPromise = (async () => {
            defaultLogger.info(`Rendering ${minecraftId}...`);
            
            // ファイル生成がまだ進行中なら待つ
            if (fileGenerationPromise) {
              defaultLogger.info(`Waiting for file generation to complete...`);
              await fileGenerationPromise;
            }
            
            // アセット取得が完了するまで待つ
            const assetsDirPath = await globalVersionManager!.getAssets(mcVersion);
            
            // ResourcePack インスタンスを再利用
            if (!resourcePack) {
              resourcePack = createResourcePack(resourcePackPath, assetsDirPath);
            }
            
            // block/ プレフィックスをつけてレンダリング
            const modelPath = `block/${minecraftId}`;
            const renderOptions: any = {
              width,
              height
            };
            if (scale !== undefined) {
              renderOptions.scale = scale;
            }
            await resourcePack.getRenderer().renderBlock(modelPath, cacheFile, renderOptions);

            const imageBuffer = readFileSync(cacheFile);
            defaultLogger.info(`Rendered and cached: ${minecraftId}`);
            return imageBuffer;
          })();

          renderingTasks.set(minecraftId, renderPromise);

          try {
            const imageBuffer = await renderPromise;
            sendResponse(imageBuffer);
          } finally {
            renderingTasks.delete(minecraftId);
          }
        } catch (error) {
          defaultLogger.error(`Failed to render minecraft item: ${error}`);
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.end('Failed to render minecraft item');
          }
          const minecraftId = req.url?.replace('/@hato810424:mc-resources-plugin/minecraft:', '').split('?')[0];
          if (minecraftId) {
            renderingTasks.delete(minecraftId);
          }
        }
      })
    },
  } satisfies PluginOption;
};

export default mcResourcesPlugin;
