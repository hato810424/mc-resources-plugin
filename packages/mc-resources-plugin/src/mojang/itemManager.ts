import { existsSync, readFileSync } from 'fs';
import type { MinecraftVersionManager } from './minecraftVersionManager';
import defaultLogger from '../logger';
import { join } from 'path';

export interface ItemData {
  id: string;
  labelKey: string;
}

class ItemManager {
  private versionManager: MinecraftVersionManager;

  constructor(versionManager: MinecraftVersionManager) {
    this.versionManager = versionManager;
  }

  /**
   * en_us.json からアイテムID一覧を取得
   */
  async getItemIds(versionId: string): Promise<string[]> {
    try {
      const langData = await this.getLangFile(versionId, 'en_us');
      const itemIds: string[] = [];
      for (const key in langData) {
        const parts = key.split('.');

        // パーツ数が3つであることを確認 (category.namespace.id)
        if (parts.length === 3) {
          const [category, namespace, id] = parts;

          // item, block, entity の中から /give に関係するものだけを抽出
          if (['item', 'block', 'entity'].includes(category) && namespace === 'minecraft') {

            const fullId = `minecraft:${id}`;
            itemIds.push(fullId);
          }
        }
      }

      defaultLogger.info(`Extracted ${itemIds.length} item IDs from ${versionId}`);
      return itemIds;
    } catch (error) {
      defaultLogger.error(`Failed to get item IDs for ${versionId}: ${error}`);
      throw error;
    }
  }

  /**
   * アイテムIDからテクスチャパスを取得
   */
  async getItemTexturePath(versionId: string, itemId: string): Promise<string | null> {
    // 1. IDをファイルパスに変換 (例: minecraft:diamond -> models/item/diamond.json)
    const [namespace, id] = itemId.includes(':') ? itemId.split(':') : ['minecraft', itemId];
    if (namespace !== 'minecraft') {
      throw new Error(`Invalid item ID: ${itemId}`);
    }

    const assetsDir = await this.versionManager.getAssets(versionId);
    const modelPath = join(assetsDir, 'assets', 'minecraft', 'models', 'item', `${id}.json`);
    
    // 2. モデルを再帰的に追いかける
    let currentModelPath = modelPath;
    while (existsSync(currentModelPath)) {
      const model = JSON.parse(readFileSync(currentModelPath, 'utf8'));

      // layer0があれば、それがそのアイテムの「顔」となるテクスチャ
      if (model.textures && model.textures.layer0) {
        let textureId = model.textures.layer0;
        // 'minecraft:item/diamond' -> 'textures/item/diamond.png'
        const [texNamespace, texPath] = textureId.includes(':') ? textureId.split(':') : ['minecraft', textureId];
        return join(assetsDir, 'assets', 'minecraft', 'textures', `${texPath}.png`);
      }

      // layer0がない場合、parentを辿る
      if (model.parent) {
        const [parentNamespace, parentPath] = model.parent.split(':');
        // 親が block/系 の場合は models/block/ を見に行く必要がある
        currentModelPath = join(assetsDir, 'assets', 'minecraft', 'models', 'block', `${parentPath}.json`);
      } else {
        break;
      }
    }

    return null; // 見つからない場合
  }

  /**
   * 指定言語でアイテムの表示名を取得
   */
  async getItemLabel(
    versionId: string,
    itemId: string,
    lang: string = 'en_us'
  ): Promise<string> {
    try {
      const langData = await this.getLangFile(versionId, lang);
      const labelKey = `.minecraft.${itemId.replace('minecraft:', '')}`;
      return langData["item" + labelKey] || langData["block" + labelKey] || langData["entity" + labelKey] || itemId;
    } catch (error) {
      defaultLogger.warn(`Failed to get label for ${itemId} in ${lang}: ${error}`);
      return itemId;
    }
  }

  /**
   * 言語ファイルを取得（en_us はアセットから、他言語はAsset Indexから）
   */
  private async getLangFile(
    versionId: string,
    lang: string = 'en_us'
  ): Promise<Record<string, string>> {
    try {
      defaultLogger.info(`Loading language file: ${versionId}/${lang}`);
      const langFilePath = await this.versionManager.getLangFile(versionId, lang);

      if (!existsSync(langFilePath)) {
        throw new Error(`Language file not found: ${lang}.json`);
      }

      const langData = JSON.parse(readFileSync(langFilePath, 'utf-8')) as Record<string, string>;
      defaultLogger.debug(`Language file loaded: ${versionId}/${lang}`);

      return langData;
    } catch (error) {
      defaultLogger.error(`Failed to load language file ${lang} for ${versionId}: ${error}`);
      throw error;
    }
  }

  /**
   * 複数の言語でアイテムラベルを取得
   */
  async getItemLabelsByLangs(
    versionId: string,
    itemId: string,
    langs: string[] = ['en_us']
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    for (const lang of langs) {
      try {
        result[lang] = await this.getItemLabel(versionId, itemId, lang);
      } catch (error) {
        defaultLogger.warn(`Failed to get label for ${itemId} in ${lang}`);
        result[lang] = itemId;
      }
    }

    return result;
  }
}

export type { ItemManager };
export function createItemManager(
  versionManager: MinecraftVersionManager
): ItemManager {
  return new ItemManager(versionManager);
}
