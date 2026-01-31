import { promises as fsPromises } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import type { ImageInfo } from './types';
import type { ItemManager } from './mojang/itemManager';
import { format } from 'node:util';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * 画像情報から getMcResources 関数を生成
 */
export async function generateGetResourcePackCode({
  images,
  usedIds,
  itemManager,
  versionId,
  itemsUrlMap,
}: {
  images: ImageInfo[];
  usedIds?: Set<string>;
  itemManager?: ItemManager;
  versionId: string;
  itemsUrlMap?: Map<string, string>;
}): Promise<string> {
  // usedIdsが指定されている場合、使用されているアイテムのみフィルタリング
  let filteredImages = usedIds ? images.filter(img => {
    const itemId = "minecraft:" + img.path.split('/').pop()?.replace(/\.[^.]+$/, '');
    return usedIds.has(itemId);
  }) : images;

  // itemManagerが指定されている場合、存在するアイテムのみにフィルタリング（並列化）
  const items = new Set<string>();
  
  if (itemManager) {
    // 3Dアイテムリストを取得（キャッシュがあれば使用、なければ空配列）
    const items3dList = await itemManager.get3DItemsLazy(versionId);
    items3dList.forEach(id => items.add(id));

    const itemIds = await itemManager.getItemIds(versionId);
    itemIds.forEach(id => items.add(id));
  }

  let itemsImports = '';
  const itemHashMap = new Map<string, Map<string, string>>(); // itemId -> (optionHash -> importVar)
  
  if (itemsUrlMap) {
    let importIndex = 0;
    for (const [key, renderedPath] of itemsUrlMap) {
      // key format: "minecraft:itemId" or "minecraft:itemId_optionHash"
      const lastUnderscore = key.lastIndexOf('_');
      let itemId: string;
      let optionHash: string;
      
      if (lastUnderscore > 0) {
        const possibleHash = key.substring(lastUnderscore + 1);
        if (!possibleHash.includes(':')) {
          itemId = key.substring(0, lastUnderscore);
          optionHash = possibleHash;
        } else {
          itemId = key;
          optionHash = 'default';
        }
      } else {
        itemId = key;
        optionHash = 'default';
      }
      
      const importVarName = `_r${importIndex}`;
      itemsImports += `import ${importVarName} from "${renderedPath}";\n`;
      
      if (!itemHashMap.has(itemId)) {
        itemHashMap.set(itemId, new Map());
      }
      itemHashMap.get(itemId)!.set(optionHash, importVarName);
      importIndex++;
    }
  }

  // リソースパックマッピングを生成
  const mapEntries: string[] = [];
  
  items.forEach(itemId => {
    const hashMap = itemHashMap.get(itemId);
    if (hashMap && hashMap.has('default')) {
      mapEntries.push(`    "${itemId}": ${hashMap.get('default')}`);
    } else {
      // レンダリングされていない場合は（no Build Mode）、デフォルトのエンドポイント
      mapEntries.push(`    "${itemId}": "/@hato810424:mc-resources-plugin/minecraft:${itemId.replace('minecraft:', '')}"`);
    }
  });

  if (itemHashMap.size > 0) {
    for (const [itemId, hashMap] of itemHashMap) {
      const isAlreadyAdded = filteredImages.some(img => 
        `minecraft:${img.path.split('/').pop()?.replace(/\.[^.]+$/, '')}` === itemId
      );
      
      if (!isAlreadyAdded) {
        for (const [optionHash, importVar] of hashMap) {
          if (optionHash === 'default') {
            mapEntries.push(`    "${itemId}": ${importVar}`);
          } else {
            mapEntries.push(`    "${itemId}_${optionHash}": ${importVar}`);
          }
        }
      }
    }
  }

  const finalMap = mapEntries.join(',\n');

  return `${itemsImports}

const resourcePack = {
${finalMap}
};

function buildQueryString(params) {
  return new URLSearchParams(
    Object.entries(params).reduce((acc, [key, value]) => {
      if (value !== undefined && value !== null) {
        acc[key] = String(value);
      }
      return acc;
    }, {})
  ).toString();
}

function generateOptionHash(width, height, scale) {
  const parts = [];
  if (width !== undefined) parts.push(\`w\${width}\`);
  if (height !== undefined) parts.push(\`h\${height}\`);
  if (scale !== undefined) parts.push(\`s\${scale}\`);
  return parts.join('_');
}

export function getResourcePack(itemId, options = {}) {
  // ビルド時にレンダリングされた画像を優先的に使用
  if (options.width || options.height || options.scale) {
    const optionHash = generateOptionHash(options.width, options.height, options.scale);
    const hashKey = \`\${itemId}_\${optionHash}\`;
    const hashedUrl = resourcePack[hashKey];
    if (hashedUrl) {
      return hashedUrl;
    }
  }
  
  const resourceUrl = resourcePack[itemId] ?? null;
  if (!resourceUrl) return null;
  
  const queryString = buildQueryString(options);
  return queryString ? \`\${resourceUrl}?\${queryString}\` : resourceUrl;
}

export default resourcePack;`;
}

/**
 * TypeScript型定義を生成
 */
export async function generateTypeDefinitions({
  images,
  itemManager,
  versionId,
}: {
  images: ImageInfo[];
  itemManager?: ItemManager;
  versionId?: string;
}): Promise<string> {
  const filteredImages = images;
  
  const FunctionOptions = `
type FunctionOptions = {
  width: number;
  height?: number;
  scale?: number;
};
  `.replace(/^\n/, '').replace(/[ \t]+$/, '');

  // itemManagerが指定されている場合、存在するアイテムのみにフィルタリング（並列化）
  if (itemManager && versionId) {
    let itemMap = new Set<string>();
    let items = new Set<string>();

    // 3Dアイテムリストを取得（キャッシュがあれば使用、なければ空配列）
    const items3dList = await itemManager.get3DItemsLazy(versionId);
    items3dList.forEach(id => items.add(id));

    const itemIds = await itemManager.getItemIds(versionId);
    itemIds.forEach(id => items.add(id));

      // フィルタード画像からのみマップを生成
    const itemMapPromises = filteredImages.map(async (img) => {
      const itemId = "minecraft:" + img.path.split('/').pop()?.replace(/\.[^.]+$/, '');

      if (itemId) {
        try {
          const texturePath = await itemManager.getItemTexturePath(versionId, itemId);
          if (texturePath) {
            return itemId;
          }
        } catch (error) {
          // テクスチャパス取得エラーは無視
        }
      }
      return null;
    });

    const results = await Promise.all(itemMapPromises);
    for (const itemId of results) {
      if (itemId) {
        itemMap.add(itemId);
      }
    }

    // 3DアイテムをitemMapに追加
    const allItems = new Set([...itemMap, ...items]);

    const Items = itemMap;
    const renderItems = items;

    const hasFunctionSignature = allItems.size > 0;
    return format(
      `
      type ItemId = %s;
      type RenderingItemId = %s;
      %s
      %s
      export const resourcePack: Readonly<Record<ItemId | RenderingItemId, string>>;
      export default resourcePack;
      `
        .replace(/^\n/, '')
        .replace(/[ \t]+$/, ''),
      Items.size > 0 ? Array.from(Items).map((item) => `"${item}"`).join(' | ') : '""',
      renderItems.size > 0 ? Array.from(renderItems).map((item) => `"${item}"`).join(' | ') : '""',
      FunctionOptions,
      (hasFunctionSignature ? `
      export function getResourcePack(itemId: ItemId): string;
      export function getResourcePack(itemId: RenderingItemId, options?: FunctionOptions): string;
      ` : '').replace(/^\n/, '').replace(/[ \t]+$/, ''),
    );
  } else {
    return format(
      `
      type ItemId = %s;
      %s
      %s
      export const resourcePack: Readonly<Record<ItemId, string>>;
      export default resourcePack;
      `
        .replace(/^\n/, '')
        .replace(/[ \t]+$/, ''),
      filteredImages.length > 0 ? filteredImages.map((img) => `"${img.path}"`).join(' | ') : '""',
      FunctionOptions,
      filteredImages.length > 0 ? 'export function getResourcePack(path: ItemId): string;' : ''
    );
  }
}
