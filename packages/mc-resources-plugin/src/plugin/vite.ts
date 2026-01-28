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
  /**
   * ファイル生成関数
   */
  const generateFiles = async ({
    usedIds = undefined,
    isBase64 = false,
  }: {
    usedIds?: Set<string>;
    isBase64?: boolean;
  } = {}): Promise<void> => {
    if (isGenerated) return; // 既に生成済みの場合スキップ

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
  };
  
  let isBuild = false;
  let isPreview = false;
  let resourcePack: MinecraftResourcePack | null = null;
  let outDir: string;
  return {
    name: '@hato810424/mc-resources-plugin',

    configResolved: (config) => {
      // グローバルインスタンスの初期化
      globalVersionManager = createVersionManager(cacheDir!);
      globalItemManager = createItemManager(globalVersionManager);

      // アセットをMojangから取得
      globalVersionManager.getAssets(mcVersion);

      outDir = config.build.outDir;
      if (config.command === 'build') {
        isBuild = true;
      }

      if (config.isProduction && config.command === 'serve') {
        isPreview = true;
      }
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
        // dev モード
        await generateFiles({ isBase64: true });
      } else {
        // build モード
        // ビルド開始時に、使用されているMinecraft IDをスキャン
        const root = process.cwd();
        const detectedIds = scanSourceCode(root, { include, exclude, outputPath, viteOutDir: outDir });
        await generateFiles({ usedIds: detectedIds.size > 0 ? detectedIds : undefined });
      }
    },

    // レンダリングが必要なアイテム
    configureServer: (server) => {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/@hato810424:mc-resources-plugin/minecraft:')) {
          next();
          return;
        }

        try {
          // URL から ID を抽出 (e.g., /@hato810424:mc-resources-plugin/minecraft:stone => stone)
          const minecraftId = req.url.replace('/@hato810424:mc-resources-plugin/minecraft:', '').split('?')[0];
          
          if (!minecraftId) {
            res.statusCode = 400;
            res.end('Invalid minecraft ID');
            return;
          }

          // レスポンス送信関数
          const sendResponse = (imageBuffer: Buffer) => {
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            res.end(imageBuffer);
          };

          const cacheFile = join(cacheDir!, 'renders', `${minecraftId}.png`);
          
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
            
            // アセット取得が完了するまで待つ
            const assetsDirPath = await globalVersionManager!.getAssets(mcVersion);
            
            // ResourcePack インスタンスを再利用
            if (!resourcePack) {
              resourcePack = createResourcePack(resourcePackPath, assetsDirPath);
            }
            
            // block/ プレフィックスをつけてレンダリング
            const modelPath = `block/${minecraftId}`;
            await resourcePack.getRenderer().renderBlock(modelPath, cacheFile, {
              width: 128,
              height: 128,
            });

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
