/**
 * Minecraft リソースパック統合システム
 * リソースパック解析とレンダリングの統合ファサード
 */

import { CONFIG } from '../env';
import { ResourcePackBuilder } from './Builder';
import type { ResolvedModel, ResolvedItem } from './Builder';
import { MinecraftBlockRenderer } from './Renderer';
import { join } from 'path';

export interface RenderBlockOptions {
  outputDir?: string;
  width?: number;
  height?: number;
  scale?: number;
  rotation?: [number, number, number];
  dryRun?: boolean; // true の場合はレンダリングをスキップ
}

class MinecraftResourcePack {
  private builder: ResourcePackBuilder;
  private renderer: MinecraftBlockRenderer;

  constructor(resourcePackPath: string, modelPath?: string) {
    this.builder = new ResourcePackBuilder(resourcePackPath);
    this.renderer = new MinecraftBlockRenderer(resourcePackPath, modelPath);
  }

  /**
   * レンダラーを取得（内部使用）
   */
  getRenderer(): MinecraftBlockRenderer {
    return this.renderer;
  }

  /**
   * すべてのブロックモデルを取得
   */
  async getAllBlockModels(): Promise<ResolvedModel[]> {
    return this.builder.buildAllModels();
  }

  /**
   * すべてのアイテムを取得
   */
  async getAllItems(): Promise<ResolvedItem[]> {
    return this.builder.buildAllItems();
  }

  /**
   * ブロックモデルの詳細情報を取得
   */
  async getBlockModel(blockName: string): Promise<ResolvedModel | null> {
    const models = await this.builder.buildAllModels();
    return models.find((m) => m.name === blockName) || null;
  }

  /**
   * 複数のブロックをレンダリング
   */
  async renderBlocks(
    blockNames: string[],
    options: RenderBlockOptions = {}
  ): Promise<{ success: string[]; failed: string[] }> {
    const {
      outputDir = './renders',
      width = CONFIG.WIDTH,
      height = options.width ?? CONFIG.HEIGHT,
      scale,
      rotation = CONFIG.ROTATION,
      dryRun = false,
    } = options;
    const renderOptions = { width, height, scale, rotation };

    const result = { success: [] as string[], failed: [] as string[] };

    // すべてのレンダリングタスクを並列実行
    const renderTasks = blockNames.map(async (blockName) => {
      // minecraft:stone 形式に対応（プレフィックスを削除）
      const normalizedName = blockName.replace(/^minecraft:/, '');
      const modelPath = `block/${normalizedName}`;
      const outputPath = join(outputDir, `${normalizedName}.png`);

      try {
        if (dryRun) {
          console.log(`[DRY-RUN] Would render: ${normalizedName} -> ${outputPath}`);
          return { type: 'success', name: normalizedName };
        } else {
          await this.renderer.renderBlock(modelPath, outputPath, renderOptions);
          return { type: 'success', name: normalizedName };
        }
      } catch (error) {
        console.error(`❌ Failed to render ${blockName}:`, error);
        return { type: 'failed', name: normalizedName };
      }
    });

    const results = await Promise.allSettled(renderTasks);
    
    for (const settledResult of results) {
      if (settledResult.status === 'fulfilled') {
        const { type, name } = settledResult.value;
        if (type === 'success') {
          result.success.push(name);
        } else {
          result.failed.push(name);
        }
      } else {
        // Promise.allSettledの場合、ここには到達しない（各タスクでcatchしている）
        result.failed.push('unknown');
      }
    }

    return result;
  }

  /**
   * すべてのブロックモデルをレンダリング
   */
  async renderAllBlocks(
    options: RenderBlockOptions = {}
  ): Promise<{ success: number; failed: number }> {
    const models = await this.builder.buildAllModels();
    const blockNames = models.map((m) => m.name);

    console.log(`🎨 Rendering ${blockNames.length} block models...`);

    const result = await this.renderBlocks(blockNames, options);

    console.log(`\n📊 Render Summary:`);
    console.log(`   ✅ Success: ${result.success.length}`);
    console.log(`   ❌ Failed: ${result.failed.length}`);

    return {
      success: result.success.length,
      failed: result.failed.length,
    };
  }

  /**
   * モデルの使用テクスチャを取得
   */
  async getModelTextures(blockName: string): Promise<string[]> {
    const model = await this.getBlockModel(blockName);
    if (!model) return [];
    return model.usedTextures.map((t) => t.path);
  }

  /**
   * キャッシュをクリア
   */
  clearCache() {
    this.builder.clearCache();
  }
}

export type { MinecraftResourcePack, ResolvedModel, ResolvedItem };
export { ResourcePackBuilder, MinecraftBlockRenderer };

export function createResourcePack(resourcePackPath: string, modelPath?: string): MinecraftResourcePack {
  return new MinecraftResourcePack(resourcePackPath, modelPath);
}
