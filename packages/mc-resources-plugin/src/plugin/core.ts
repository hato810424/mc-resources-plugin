import { CONFIG } from "../env";
import { PluginOptionsSchema, type PluginOptions } from "../types";
import { getAllImages, initializeOutputDirectory, writeFiles } from '../filesystem';
import { generateGetResourcePackCode, generateTypeDefinitions } from '../codeGenerator';
import defaultLogger from '../logger';
import type { ItemManager } from '../mojang/itemManager';
import { createVersionManager, type MinecraftVersionManager } from '../mojang/minecraftVersionManager';
import { createItemManager } from '../mojang/itemManager';
import { createResourcePack, type MinecraftResourcePack } from "../render/ResourcePack";
import path, { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { scanSourceCode } from "../codeScanner";
import type { IncomingHttpHeaders } from "node:http";
import type { RenderOptions } from "../render/Renderer";
import chalk from "chalk";

export const parseConfig = (options: PluginOptions) => {
  const validatedOptions = PluginOptionsSchema.parse(options);
  return {
    mcVersion: validatedOptions.mcVersion,
    resourcePackPath: validatedOptions.resourcePackPath,
    outputPath: validatedOptions.outputPath ?? CONFIG.OUTPUT_DIR,
    emptyOutDir: validatedOptions.emptyOutDir ?? CONFIG.EMPTY_OUT_DIR,
    include: validatedOptions.include ?? CONFIG.INCLUDE,
    exclude: validatedOptions.exclude ?? CONFIG.EXCLUDE,
    cacheDir: validatedOptions.cacheDir ?? CONFIG.CACHE_DIR!,
    startUpRenderCacheRefresh: validatedOptions.startUpRenderCacheRefresh ?? CONFIG.START_UP_RENDER_CACHE_REFRESH,
    logLevel: validatedOptions.logLevel ?? CONFIG.LOG_LEVEL,
  };
};

export class McResourcesCore {
  public readonly config: ReturnType<typeof parseConfig>;
  private renderingTasks = new Map<string, Promise<Buffer>>();
  private fileGenerationStarted = false;
  private fileGenerationPromise: Promise<void> | null = null;
  private isGenerated = false;
  private resourcePack: MinecraftResourcePack | null = null;

  private versionManager: MinecraftVersionManager;
  private itemManager: ItemManager;

  constructor(config: PluginOptions) {
    this.config = parseConfig(config);
    
    if (!this.config.cacheDir) {
      throw new Error('Cache directory is not set. Please set the cache directory in the configuration.');
    }

    // バージョンマネージャーを初期化
    this.versionManager = createVersionManager(this.config.cacheDir);
    // アイテムマネージャーを初期化
    this.itemManager = createItemManager(this.versionManager);

    // ログレベルを設定
    defaultLogger.setLogLevel(this.config.logLevel);
  }

  /**
   * ItemManagerを取得
   */
  getItemManager(): ItemManager {
    if (!this.itemManager) {
      throw new Error('ItemManager is not initialized. Call initializeManagers() first.');
    }
    return this.itemManager;
  }

  /**
   * VersionManagerを取得
   */
  getVersionManager(): MinecraftVersionManager {
    if (!this.versionManager) {
      throw new Error('VersionManager is not initialized. Call initializeManagers() first.');
    }
    return this.versionManager;
  }

  /**
   * Dev Modeのアセット取得
   */
  async getAssetsInDevMode(): Promise<void> {
    setTimeout(() => {
      this.versionManager.getAssets(this.config.mcVersion).catch(err => {
        defaultLogger.warn(`Failed to pre-fetch assets: ${err}`);
      });
    }, 500);

    // 3D アイテム取得をさらに遅延実行
    setTimeout(() => {
      this.itemManager.get3DItems(this.config.mcVersion).catch(err => {
        defaultLogger.warn(`Failed to preload 3D items: ${err}`);
      });
    }, 1000);
  }


  /**
   * Build Modeのアセット取得
   */
  async getAssetsInBuildMode(): Promise<string> {
    try {
      return await this.versionManager.getAssets(this.config.mcVersion);
    } catch (err) {
      defaultLogger.warn(`Failed to pre-fetch assets: ${err}`);
      throw err;
    }
  }

  /**
   * ファイル生成関数（遅延生成対応）
   */
  async generateFiles(options: {
    isBuild?: boolean;
    usedIds?: Set<string>;
    isBase64?: boolean;
    ensureItems3d?: boolean;
    itemsUrlMap?: Map<string, string>;
  } = {}): Promise<void> {
    const {
      isBuild = false,
      usedIds = undefined,
      isBase64 = false,
      ensureItems3d = false,
      itemsUrlMap = undefined,
    } = options;

    if (this.isGenerated) return; // 既に生成済みの場合スキップ

    // 既にファイル生成中の場合は、その完了を待つ
    if (this.fileGenerationPromise) {
      return this.fileGenerationPromise;
    }

    this.fileGenerationPromise = (async () => {
      // dev モード時かつ3Dアイテムを確実に必要な場合、先に取得
      let itemManager: ItemManager | undefined;
      try {
        itemManager = this.getItemManager();
      } catch {
        // ItemManagerが初期化されていない場合は無視
      }

      if (ensureItems3d && !isBuild && itemManager) {
        try {
          await itemManager.get3DItems(this.config.mcVersion);
        } catch (err) {
          defaultLogger.warn(`Failed to fetch 3D items: ${err}`);
        }
      }

      const images = getAllImages(this.config.resourcePackPath);

      const jsCode = await generateGetResourcePackCode({
        images,
        usedIds,
        itemManager,
        versionId: this.config.mcVersion,
        itemsUrlMap,
      });
      const tsCode = await generateTypeDefinitions({ images, itemManager, versionId: this.config.mcVersion });

      // 出力ディレクトリを初期化
      initializeOutputDirectory(this.config.outputPath, this.config.emptyOutDir);

      // ファイルを書き込む
      writeFiles(this.config.outputPath, jsCode, tsCode);

      defaultLogger.info(chalk.bgGreen('Generated') + ' TypeScript and JavaScript files');

      this.isGenerated = true;
    })();

    return this.fileGenerationPromise;
  }

  /**
   * ビルド時にアイテムをレンダリング（outputPath配下に保存）
   */
  async renderItemsForBuildWithEmit(  
    detectedIds: Set<string>,
    renderingOptions?: Map<string, { itemId: string; optionHash: string; width?: number; height?: number; scale?: number }>
  ): Promise<Map<string, string>> {
    const itemUrlMap = new Map<string, string>();
    
    if (detectedIds.size === 0) {
      return itemUrlMap;
    }

    try {
      // アセット取得
      const assetsDirPath = await this.versionManager.getAssets(this.config.mcVersion);
      
      // ResourcePack インスタンスを初期化
      if (!this.resourcePack) {
        this.resourcePack = createResourcePack(this.config.resourcePackPath, assetsDirPath);
      }

      // 出力ディレクトリの rendered-items フォルダを作成
      const renderedItemsDir = join(this.config.outputPath, 'rendered-items');
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
          if (detectedIds.has(opt.itemId)) { // 検出されたIDに含まれるか確認
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
      for (const itemId of detectedIds) {
        if (!processedItems.has(itemId)) {
          renderTargets.push({ itemId });
        }
      }

      defaultLogger.info(`Rendering ${renderTargets.length} items for build...`);

      // 各組み合わせをレンダリング
      for (const target of renderTargets) {
        try {
          const cleanId = target.itemId.replace('minecraft:', '');
          // デフォルト時はhashを含めない
          const fileName = target.optionHash && target.optionHash !== 'default' ? `${cleanId}_${target.optionHash}.png` : `${cleanId}.png`;
          const outputFile = join(renderedItemsDir, fileName);
          
          const isItemModel = await this.itemManager.isItem2DModel(target.itemId, assetsDirPath);

          const modelPath = isItemModel ? `item/${cleanId}` : `block/${cleanId}`;

          const renderOptions = {
            width: target.width ?? (isItemModel ? CONFIG.TEXTURE_SIZE : CONFIG.WIDTH),
            height: target.height ?? target.width ?? (isItemModel ? CONFIG.TEXTURE_SIZE : CONFIG.WIDTH),
            ...(target.scale !== undefined && { scale: target.scale })
          };

          if (isItemModel) {
            await this.resourcePack!.getRenderer().renderItem(modelPath, outputFile, renderOptions);
          } else {
            await this.resourcePack!.getRenderer().renderBlock(modelPath, outputFile, renderOptions);
          }
          defaultLogger.info(`Rendered: ${target.itemId} with options: ${JSON.stringify(renderOptions)}`);
          
          const mapKey = target.optionHash ? `${target.itemId}_${target.optionHash}` : target.itemId;
          // 相対パスを記録（importで使用）
          const relativePath = `/${path.relative(process.cwd(), join(renderedItemsDir, fileName)).replace(/\\/g, '/')}`;
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

  /**
   * Build
   */
  async build(options: { distDir: string }): Promise<void> {
    try {
      await this.getAssetsInBuildMode();
    } catch (err) {
      defaultLogger.warn(`Failed to get assets: ${err}`);
    }
    
    // ビルド開始時に、使用されているMinecraft IDをスキャン（オプション情報も抽出）
    const root = process.cwd();
    const scanResult = scanSourceCode(root, {
      include: this.config.include,
      exclude: this.config.exclude,
      outputPath: this.config.outputPath,
      distDir: path.relative(root, options.distDir),
    });
    const detectedIds = scanResult.usedIds;
    const renderingOptions = scanResult.renderingOptions;
    
    // ビルド時に3Dアイテムをレンダリング（実際のURLで記録）
    defaultLogger.debug(`Rendering options: ${JSON.stringify(Array.from(renderingOptions?.entries() ?? []))}`);
    const itemsUrlMap = await this.renderItemsForBuildWithEmit(detectedIds, renderingOptions);

    // ファイル生成（実際のレンダリングURLを渡す）
    await this.generateFiles({ 
      usedIds: detectedIds.size > 0 ? detectedIds : undefined,
      itemsUrlMap 
    });
  }

  /**
   * Dev Server Start
   */
  async devServerStart(): Promise<void> {
    this.fileGenerationStarted = true;
    defaultLogger.debug('Starting file generation in background...');
    
    // ファイル生成をバックグラウンドで実行（await しない）
    this.generateFiles({ isBase64: true, ensureItems3d: true }).catch(err => {
      defaultLogger.warn(`Failed to generate files: ${err}`);
    });
  }

  /**
   * Dev Server Middleware
   */
  async devServerMiddleware(options: {
    next: () => void,
    req: {
      url: string | undefined,
      headers: IncomingHttpHeaders,
    },
    res: {
      setStatus: (statusCode: number) => void,
      setHeader: (name: 'Content-Type', value: string) => void,
      send: (body: string | Buffer) => void,
    },
    isBuild: boolean,
    isGenerated: boolean,
  }): Promise<void> {
    const { next, req, res, isBuild, isGenerated } = options;
    const { url, headers } = req;

    // dev モード時かつまだ生成していない場合、バックグラウンドで生成開始
    if (!isBuild && !isGenerated && !this.fileGenerationStarted) {
      this.fileGenerationStarted = true;
      defaultLogger.debug('Starting file generation in background...');
      
      // ファイル生成をバックグラウンドで実行（await しない）
      this.generateFiles({ isBase64: true, ensureItems3d: true }).catch(err => {
        defaultLogger.warn(`Failed to generate files: ${err}`);
      });
    }

    // ミドルウェアは即座に次に進む（ブロッキングしない）
    if (!url?.startsWith('/@hato810424:mc-resources-plugin/minecraft:')) {
      next();
      return;
    }

    try {
      // URL パースしてクエリパラメータを取得
      const urlObj = new URL(url!, `http://${headers.host}`);
      const minecraftId = urlObj.pathname.replace('/@hato810424:mc-resources-plugin/minecraft:', '');
      
      if (!minecraftId) {
        res.setStatus(400);
        res.send('Invalid minecraft ID');
        return;
      }

      // アセット取得が完了するまで待つ
      const assetsDirPath = await this.versionManager.getAssets(this.config.mcVersion);
        
      // ResourcePack インスタンスを再利用
      if (!this.resourcePack) {
        this.resourcePack = createResourcePack(this.config.resourcePackPath, assetsDirPath);
      }
      
      // ItemManager を初期化
      if (!this.itemManager) {
        this.itemManager = createItemManager(this.versionManager);
      }

      // モデルの表示タイプを ItemManager を使って判断
      const isItemModel = this.itemManager.isItem2DModel(minecraftId, assetsDirPath);

      // クエリパラメータから width, height, scale を取得
      const baseSize = isItemModel ? CONFIG.TEXTURE_SIZE : CONFIG.WIDTH;
      const width = parseInt(urlObj.searchParams.get('width') ?? String(baseSize), 10);
      const height = parseInt(urlObj.searchParams.get('height') ?? String(width), 10);
      const scaleParam = urlObj.searchParams.get('scale');
      const scale = scaleParam ? parseFloat(scaleParam) : undefined;

      // レスポンス送信関数
      const sendResponse = (imageBuffer: Buffer) => {
        res.setHeader('Content-Type', 'image/png');
        res.send(imageBuffer);
      };

      // キャッシュキーにサイズ情報を含める（オプションの順序を統一）
      const scaleStr = scale !== undefined ? `_${scale}` : '';
      const cacheKey = `${minecraftId}_${width}x${height}${scaleStr}.png`;
      const cacheFile = join(this.config.cacheDir!, 'renders' , cacheKey);
      
      defaultLogger.debug(`Processing request: id=${minecraftId}, width=${width}, height=${height}, scale=${scale}, cacheKey=${cacheKey}`);
      
      // 1. ファイルキャッシュを確認
      if (existsSync(cacheFile)) {
        const imageBuffer = readFileSync(cacheFile);
        sendResponse(imageBuffer);
        defaultLogger.info(`File cache hit: ${minecraftId}`);
        return;
      }

      // 2. 既にレンダリング中のタスクがあれば、それを待つ
      if (this.renderingTasks.has(cacheKey)) {
        const imageBuffer = await this.renderingTasks.get(cacheKey)!;
        sendResponse(imageBuffer);
        return;
      }

      // 3. レンダリング処理を実行
      const renderPromise = (async () => {
        defaultLogger.info(`Rendering ${minecraftId}...`);
        
        // ファイル生成がまだ進行中なら待つ
        if (this.fileGenerationPromise) {
          await this.fileGenerationPromise;
        }

        const renderPath = await this.itemManager.getItemRenderPath(this.config.mcVersion, minecraftId);

        const renderOptions: RenderOptions = {
          width,
          height
        };
        if (scale !== undefined) {
          renderOptions.scale = scale;
        }

        let outputPath = cacheFile;
        if (isItemModel) {
          outputPath = await this.resourcePack!.getRenderer().renderItem(renderPath, cacheFile, renderOptions);
        } else {
          outputPath = await this.resourcePack!.getRenderer().renderBlock(renderPath, cacheFile, renderOptions);
        }

        const imageBuffer = readFileSync(outputPath);
        defaultLogger.info(`Rendered: ${minecraftId} with options: ${JSON.stringify(renderOptions)}`);
        return imageBuffer;
      })();

      this.renderingTasks.set(cacheKey, renderPromise);

      try {
        const imageBuffer = await renderPromise;
        sendResponse(imageBuffer);
      } finally {
        this.renderingTasks.delete(cacheKey);
      }
    } catch (error) {
      defaultLogger.error(`Failed to render minecraft item: ${error}`);
      const urlObj = new URL(url!, `http://${headers.host}`);
      const extractedId = urlObj.pathname.replace('/@hato810424:mc-resources-plugin/minecraft:', '');
      const width = parseInt(urlObj.searchParams.get('width') ?? String(CONFIG.WIDTH), 10);
      const height = parseInt(urlObj.searchParams.get('height') ?? String(width), 10);
      const scaleParam = urlObj.searchParams.get('scale');
      const scale = scaleParam ? parseFloat(scaleParam) : undefined;
      const scaleStr = scale !== undefined ? `_${scale}` : '';
      const errorCacheKey = `${extractedId}_${width}x${height}${scaleStr}.png`;
      this.renderingTasks.delete(errorCacheKey);

      res.setStatus(500);
      res.send('Failed to render minecraft item');
    }
  }
}
