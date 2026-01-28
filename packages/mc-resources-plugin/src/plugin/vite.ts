import type { PluginOptions } from '../types';
import { getAllImages, initializeOutputDirectory, writeFiles } from '../filesystem';
import { generateGetResourcePackCode, generateTypeDefinitions } from '../codeGenerator';
import { scanSourceCode } from '../codeScanner';
import type { PluginOption } from 'vite';
import defaultLogger from '../logger';
import findCacheDirectory from "find-cache-directory";
import { existsSync, rmSync } from 'fs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createResourcePack, type MinecraftResourcePack } from '../render/ResourcePack';

const mcResourcesPlugin = (options: PluginOptions) => {
  const {
    resourcePackPath,
    outputPath = './mcpacks',
    emptyOutDir = false,
    include = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    exclude = [],
    cacheDir = findCacheDirectory({
      name: '@hato810424/mc-resources-plugin',
      create: true,
    }),
    startUpCacheRefresh = false,
  } = options;

  let isGenerated = false;
  let resourcePack: MinecraftResourcePack | null = null;
  const renderingTasks = new Map<string, Promise<Buffer>>();
  const memoryCache = new Map<string, Buffer>();
  /**
   * ファイル生成関数
   */
  const generateFiles = ({
    usedImagePaths = undefined,
    isBase64 = false,
  }: {
    usedImagePaths?: Set<string>;
    isBase64?: boolean;
  } = {}): void => {
    if (isGenerated) return; // 既に生成済みの場合スキップ

    const images = getAllImages(resourcePackPath);
    
    const jsCode = generateGetResourcePackCode({ images, resourcePackPath, isBase64, usedPaths: usedImagePaths });
    const tsCode = generateTypeDefinitions(images, usedImagePaths);

    // 出力ディレクトリを初期化
    initializeOutputDirectory(outputPath, emptyOutDir);

    // ファイルを書き込む
    writeFiles(outputPath, jsCode, tsCode);

    const displayCount = usedImagePaths ? usedImagePaths.size : images.length;
    defaultLogger.info(`Generated with ${displayCount} images (found ${images.length} total)`);

    isGenerated = true;
  };

  let isBuild = false;
  return {
    name: '@hato810424/mc-resources-plugin',

    configResolved: (config) => {
      if (config.command === 'build') {
        isBuild = true;
      }
    },

    buildStart: () => {
      // 起動時にキャッシュをクリア
      if (startUpCacheRefresh) {
        rmSync(cacheDir!, { recursive: true, force: true });
      }

      if (!isBuild) {
        // dev モード
        generateFiles({ isBase64: true });
      } else {
        // build モード
        // ビルド開始時に、使用されている画像をスキャン
        const root = process.cwd();
        const detectedPaths = scanSourceCode(root, { include, exclude, outputPath });
        generateFiles({ usedImagePaths: detectedPaths.size > 0 ? detectedPaths : undefined });
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

          // 1. メモリキャッシュを確認
          if (memoryCache.has(minecraftId)) {
            const imageBuffer = memoryCache.get(minecraftId)!;
            sendResponse(imageBuffer);
            defaultLogger.info(`Memory cache hit: ${minecraftId}`);
            return;
          }

          const cacheFile = join(cacheDir!, 'renders', `${minecraftId}.png`);
          
          // 2. ファイルキャッシュを確認
          if (existsSync(cacheFile)) {
            const imageBuffer = readFileSync(cacheFile);
            memoryCache.set(minecraftId, imageBuffer);
            sendResponse(imageBuffer);
            defaultLogger.info(`File cache hit: ${minecraftId}`);
            return;
          }

          // 3. 既にレンダリング中のタスクがあれば、それを待つ
          if (renderingTasks.has(minecraftId)) {
            defaultLogger.info(`Waiting for pending render: ${minecraftId}`);
            const imageBuffer = await renderingTasks.get(minecraftId)!;
            sendResponse(imageBuffer);
            return;
          }

          // 4. レンダリング処理を実行
          const renderPromise = (async () => {
            defaultLogger.info(`Rendering ${minecraftId}...`);
            
            // ResourcePack インスタンスを再利用
            if (!resourcePack) {
              resourcePack = createResourcePack(resourcePackPath);
            }
            
            // block/ プレフィックスをつけてレンダリング
            const modelPath = `block/${minecraftId}`;
            await resourcePack.getRenderer().renderBlock(modelPath, cacheFile, {
              width: 128,
              height: 128,
            });

            const imageBuffer = readFileSync(cacheFile);
            memoryCache.set(minecraftId, imageBuffer);
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
