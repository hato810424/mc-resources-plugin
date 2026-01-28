import { PluginOptionsSchema, type PluginOptions } from '../types';
import { getAllImages, initializeOutputDirectory, writeFiles } from '../filesystem';
import { generateGetResourcePackCode, generateTypeDefinitions } from '../codeGenerator';
import { scanSourceCode } from '../codeScanner';
import type { PluginOption } from 'vite';
import defaultLogger from '../logger';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createResourcePack, type MinecraftResourcePack } from '../render/ResourcePack';
import { createVersionManager, type MinecraftVersionManager } from '../mojang/minecraftVersionManager';
import { createItemManager, type ItemManager } from '../mojang/itemManager';
import { CONFIG } from '../env';

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
    outputPath = CONFIG.OUTPUT_DIR,
    emptyOutDir = CONFIG.EMPTY_OUT_DIR,
    include = CONFIG.INCLUDE,
    exclude = CONFIG.EXCLUDE,
    cacheDir = CONFIG.CACHE_DIR!,
    startUpRenderCacheRefresh = CONFIG.START_UP_RENDER_CACHE_REFRESH,
    logLevel = CONFIG.LOG_LEVEL,
  } = validatedOptions;

  defaultLogger.setLogLevel(logLevel);

  const renderingTasks = new Map<string, Promise<Buffer>>();
  let fileGenerationPromise: Promise<void> | null = null;
  
  /**
   * ファイル生成関数（遅延生成対応）
   */
  const generateFiles = async ({
    usedIds = undefined,
    isBase64 = false,
    ensureItems3d = false,
    items3dUrlMap = undefined,
  }: {
    usedIds?: Set<string>;
    isBase64?: boolean;
    ensureItems3d?: boolean;
    items3dUrlMap?: Map<string, string>;
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
      
      const jsCode = await generateGetResourcePackCode({ 
        images, 
        resourcePackPath, 
        isBase64, 
        usedIds, 
        itemManager: globalItemManager, 
        versionId: mcVersion,
        items3dUrlMap,
      });
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

  /**
   * ビルド時に3Dアイテムをレンダリング（outputPath配下に保存）
   */
  const renderItems3dForBuildWithEmit = async (
    detectedIds: Set<string>,
    renderingOptions?: Map<string, { itemId: string; optionHash: string; width?: number; height?: number; scale?: number }>
  ): Promise<Map<string, string>> => {
    const itemUrlMap = new Map<string, string>();
    
    if (!globalItemManager || detectedIds.size === 0) {
      return itemUrlMap;
    }

    try {
      // ビルド時は3Dアイテムリストを完全に取得（キャッシュなし）
      const items3dList = await globalItemManager.get3DItems(mcVersion);
      const items3dSet = new Set(items3dList);
      
      // 検出されたIDと3Dアイテムの交差を取得
      const items3dToRender = Array.from(detectedIds).filter(id => items3dSet.has(id));
      
      if (items3dToRender.length === 0) {
        return itemUrlMap;
      }

      defaultLogger.info(`Rendering ${items3dToRender.length} 3D items for build...`);
      
      // アセット取得
      const assetsDirPath = await globalVersionManager!.getAssets(mcVersion);
      
      // ResourcePack インスタンスを初期化
      if (!resourcePack) {
        resourcePack = createResourcePack(resourcePackPath, assetsDirPath);
      }

      // 出力ディレクトリの rendered-items フォルダを作成
      const renderedItemsDir = join(outputPath, 'rendered-items');
      if (existsSync(renderedItemsDir)) {
        rmSync(renderedItemsDir, { recursive: true });
      }
      mkdirSync(renderedItemsDir, { recursive: true });

      // レンダリング対象の組み合わせを構築
      const renderTargets: { itemId: string; optionHash?: string; width?: number; height?: number; scale?: number }[] = [];
      const processedItems = new Set<string>();
      
      // オプションが指定されているアイテムをレンダリング
      if (renderingOptions && renderingOptions.size > 0) {
        for (const [, opt] of renderingOptions) {
          if (items3dSet.has(opt.itemId)) {
            renderTargets.push({
              itemId: opt.itemId,
              optionHash: opt.optionHash,
              width: opt.width,
              height: opt.height,
              scale: opt.scale,
            });
            processedItems.add(opt.itemId);
          }
        }
      }
      
      // オプション指定されていないアイテムをデフォルトでレンダリング
      for (const itemId of items3dToRender) {
        if (!processedItems.has(itemId)) {
          renderTargets.push({ itemId });
        }
      }

      // 各組み合わせをレンダリング
      for (const target of renderTargets) {
        try {
          const cleanId = target.itemId.replace('minecraft:', '');
          // デフォルト時はhashを含めない
          const fileName = target.optionHash && target.optionHash !== 'default' ? `${cleanId}_${target.optionHash}.png` : `${cleanId}.png`;
          const outputFile = join(renderedItemsDir, fileName);
          
          const modelPath = `block/${cleanId}`;
          
          const renderOptions = {
            width: target.width ?? CONFIG.WIDTH,
            height: target.height ?? target.width ?? CONFIG.WIDTH,
            ...(target.scale !== undefined && { scale: target.scale })
          };
          
          await resourcePack.getRenderer().renderBlock(modelPath, outputFile, renderOptions);
          defaultLogger.info(`Rendered: ${target.itemId} with options: ${JSON.stringify(renderOptions)}`);
          
          const mapKey = target.optionHash ? `${target.itemId}_${target.optionHash}` : target.itemId;
          // 相対パスを記録（importで使用）
          const relativePath = `./rendered-items/${fileName}`;
          itemUrlMap.set(mapKey, relativePath);
          defaultLogger.info(`Rendered item saved: ${mapKey} -> ${relativePath}`);
        } catch (err) {
          defaultLogger.warn(`Failed to render ${target.itemId} with options ${target.optionHash || 'default'}: ${err}`);
        }
      }
    } catch (error) {
      defaultLogger.error(`Failed to render items for build: ${error}`);
    }

    return itemUrlMap;
  };
  
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
        // dev モード
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
        await globalVersionManager.getAssets(mcVersion).catch(err => {
          defaultLogger.warn(`Failed to pre-fetch assets: ${err}`);
        });
      }

      outDir = config.build.outDir;
    },

    buildStart: async function() {
      if (isPreview) {
        return;
      }

      // 起動時にキャッシュをクリア
      if (startUpRenderCacheRefresh) {
        rmSync(join(cacheDir!, 'renders'), { recursive: true, force: true });
      }

      if (!isBuild) {
        // dev モード
      } else {
        // build モード: 事前にレンダリング
        try {
          await globalVersionManager!.getAssets(mcVersion);
        } catch (err) {
          defaultLogger.warn(`Failed to get assets: ${err}`);
        }
        
        // ビルド開始時に、使用されているMinecraft IDをスキャン（オプション情報も抽出）
        const root = process.cwd();
        const scanResult = scanSourceCode(root, { include, exclude, outputPath, viteOutDir: outDir });
        const detectedIds = scanResult.usedIds;
        const renderingOptions = scanResult.renderingOptions;
        
        // ビルド時に3Dアイテムをレンダリング（実際のURLで記録）
        const items3dUrlMap = await renderItems3dForBuildWithEmit(detectedIds, renderingOptions);
        
        // ファイル生成（実際のレンダリングURLを渡す）
        await generateFiles({ 
          usedIds: detectedIds.size > 0 ? detectedIds : undefined,
          items3dUrlMap 
        });
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
          defaultLogger.debug('Starting file generation in background...');
          
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

          // キャッシュキーにサイズ情報を含める（オプションの順序を統一）
          const scaleStr = scale !== undefined ? `_${scale}` : '';
          const cacheKey = `${minecraftId}_${width}x${height}${scaleStr}.png`;
          const cacheFile = join(cacheDir!, 'renders' , cacheKey);
          
          defaultLogger.debug(`Processing request: id=${minecraftId}, width=${width}, height=${height}, scale=${scale}, cacheKey=${cacheKey}`);
          
          // 1. ファイルキャッシュを確認
          if (existsSync(cacheFile)) {
            const imageBuffer = readFileSync(cacheFile);
            sendResponse(imageBuffer);
            defaultLogger.info(`File cache hit: ${minecraftId}`);
            return;
          }

          // 2. 既にレンダリング中のタスクがあれば、それを待つ
          if (renderingTasks.has(cacheKey)) {
            const imageBuffer = await renderingTasks.get(cacheKey)!;
            sendResponse(imageBuffer);
            return;
          }

          // 3. レンダリング処理を実行
          const renderPromise = (async () => {
            defaultLogger.info(`Rendering ${minecraftId}...`);
            
            // ファイル生成がまだ進行中なら待つ
            if (fileGenerationPromise) {
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
            defaultLogger.info(`Rendered: ${minecraftId} with options: ${JSON.stringify(renderOptions)}`);
            return imageBuffer;
          })();

          renderingTasks.set(cacheKey, renderPromise);

          try {
            const imageBuffer = await renderPromise;
            sendResponse(imageBuffer);
          } finally {
            renderingTasks.delete(cacheKey);
          }
        } catch (error) {
          defaultLogger.error(`Failed to render minecraft item: ${error}`);
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.end('Failed to render minecraft item');
          }
          const url = new URL(req.url || '', `http://${req.headers.host}`);
          const extractedId = url.pathname.replace('/@hato810424:mc-resources-plugin/minecraft:', '');
          const width = parseInt(url.searchParams.get('width') ?? '128', 10);
          const height = parseInt(url.searchParams.get('height') ?? String(width), 10);
          const scaleParam = url.searchParams.get('scale');
          const scale = scaleParam ? parseFloat(scaleParam) : undefined;
          const scaleStr = scale !== undefined ? `_${scale}` : '';
          const errorCacheKey = `${extractedId}_${width}x${height}${scaleStr}.png`;
          if (extractedId) {
            renderingTasks.delete(errorCacheKey);
          }
        }
      })
    },
  } satisfies PluginOption;
};

export default mcResourcesPlugin;
