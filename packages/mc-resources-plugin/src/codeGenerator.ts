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
 * 複数の画像を並列に読み込む（バッチ処理）
 */
async function readImagesInParallel(
  images: ImageInfo[],
  resourcePackPath: string,
  itemMap: Record<string, string>,
  concurrency: number = 50
): Promise<(string | null)[]> {
  const results: (string | null)[] = new Array(images.length);
  
  for (let i = 0; i < images.length; i += concurrency) {
    const batch = images.slice(i, i + concurrency);
    const batchPromises = batch.map(async (img) => {
      const absolutePath = join(resolve(resourcePackPath), 'assets', 'minecraft', img.relativePath);
      const itemId = "minecraft:" + img.path.split('/').pop()?.replace(/\.[^.]+$/, '');
      const itemPath = itemMap[itemId];

      if (!itemPath) {
        return null;
      }

      try {
        const imageData = await fsPromises.readFile(absolutePath);
        const base64 = imageData.toString('base64');
        const ext = extname(img.path).toLowerCase();
        const mimeType = MIME_TYPES[ext] || 'image/png';
        return `    "${itemId}": "data:${mimeType};base64,${base64}",`;
      } catch (error) {
        console.warn(`Failed to read image ${absolutePath}:`, error);
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach((result, index) => {
      results[i + index] = result;
    });
  }

  return results;
}

/**
 * Base64形式の画像マップを生成
 */
async function generateBase64ImageMap(
  images: ImageInfo[],
  resourcePackPath: string,
  itemMap: Record<string, string>
): Promise<string> {
  const results = await readImagesInParallel(images, resourcePackPath, itemMap);
  return results.filter(Boolean).join('\n');
}

/**
 * import形式の画像マップを生成
 */
function generateImportStatements(images: ImageInfo[], resourcePackPath: string, usedIds: Set<string>): string {
  return images
    .map((img, index) => {
      const absolutePath = join(resolve(resourcePackPath), 'assets', 'minecraft', img.relativePath);
      const fileUrl = new URL(`file://${absolutePath}`).href;
      const itemId = "minecraft:" + img.path.split('/').pop()?.replace(/\.[^.]+$/, '');
      if (usedIds.has(itemId)) {
        return `import _i${index} from "${fileUrl}?import";`;
      } else {
        return null;
      }
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * import形式の画像マップを生成
 */
function generateImportImageMap(images: ImageInfo[], itemMap: Record<string, string>): string {
  return images
    .map((img, index) => {
      const itemId = `minecraft:${img.path.split('/').pop()?.replace(/\.[^.]+$/, '')}`;
      const itemPath = itemMap[itemId];
      if (itemPath) {
        return `    "${itemId}": _i${index},`;
      } else {
        return null;
      }
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * 画像情報から getMcResources 関数を生成
 */
export async function generateGetResourcePackCode({
  images,
  resourcePackPath,
  isBase64,
  usedIds,
  itemManager,
  versionId,
}: {
  images: ImageInfo[];
  resourcePackPath: string;
  isBase64: boolean;
  usedIds?: Set<string>;
  itemManager?: ItemManager;
  versionId: string;
}): Promise<string> {
  // usedIdsが指定されている場合、使用されているアイテムのみフィルタリング
  let filteredImages = usedIds ? images.filter(img => {
    const itemId = "minecraft:" + img.path.split('/').pop()?.replace(/\.[^.]+$/, '');
    return usedIds.has(itemId);
  }) : images;

  // itemManagerが指定されている場合、存在するアイテムのみにフィルタリング（並列化）
  const itemMap: Record<string, string> = {};
  const items3d = new Set<string>();
  
  if (itemManager) {
    // 3Dアイテムリストを取得（キャッシュがあれば使用、なければ空配列）
    const items3dList = await itemManager.get3DItemsLazy(versionId);
    items3dList.forEach(id => items3d.add(id));

    // usedIds が指定されている場合のみテクスチャパスを並列取得
    if (usedIds && usedIds.size > 0) {
      const itemMapPromises = Array.from(usedIds).map(async (itemId) => {
        try {
          const texturePath = await itemManager.getItemTexturePath(versionId, itemId);
          if (texturePath) {
            return { itemId, texturePath };
          }
        } catch (error) {
          // テクスチャパス取得エラーは無視
        }
        return null;
      });

      const results = await Promise.all(itemMapPromises);
      for (const result of results) {
        if (result) {
          itemMap[result.itemId] = result.texturePath;
        }
      }
    } else if (!usedIds) {
      // usedIdsがない場合は、フィルタード画像からのみマップを生成
      const itemMapPromises = filteredImages.map(async (img) => {
        const itemId = "minecraft:" + img.path.split('/').pop()?.replace(/\.[^.]+$/, '');
        if (itemId) {
          try {
            const texturePath = await itemManager.getItemTexturePath(versionId, itemId);
            if (texturePath) {
              return { itemId, texturePath };
            }
          } catch (error) {
            // テクスチャパス取得エラーは無視
          }
        }
        return null;
      });

      const results = await Promise.all(itemMapPromises);
      for (const result of results) {
        if (result) {
          itemMap[result.itemId] = result.texturePath;
        }
      }
    }
  }

  let imports: string;
  let imageMap: string;

  if (isBase64) {
    imports = '';
    imageMap = await generateBase64ImageMap(filteredImages, resourcePackPath, itemMap);
  } else {
    imports = generateImportStatements(filteredImages, resourcePackPath, usedIds ?? new Set());
    imageMap = generateImportImageMap(filteredImages, itemMap);
  }

  // 3Dアイテムのマッピングを追加
  let items3dMap = '';
  if (items3d.size > 0) {
    const items3dEntries = Array.from(items3d)
      .map(itemId => `    "${itemId}": "/@hato810424:mc-resources-plugin/minecraft:${itemId.replace('minecraft:', '')}"`)
      .join(',\n');
    items3dMap = items3dEntries ? `,\n${items3dEntries}` : '';
  }

  // imageMapの末尾の,を削除（3Dアイテムがある場合のみ）
  let finalImageMap = imageMap;
  if (items3dMap && imageMap.trim().endsWith(',')) {
    finalImageMap = imageMap.trimEnd().slice(0, -1);
  }

  return `${imports}

const resourcePack = {
${finalImageMap}${items3dMap}
};

export function getResourcePack(path) {
  return resourcePack[path] ?? null;
}

export default resourcePack;`;
}

/**
 * TypeScript型定義を生成
 */
export async function generateTypeDefinitions({
  images,
  usedIds,
  itemManager,
  versionId,
}: {
  images: ImageInfo[];
  usedIds?: Set<string>;
  itemManager?: ItemManager;
  versionId?: string;
}): Promise<string> {
  let filteredImages = usedIds ? images.filter(img => {
    const itemId = "minecraft:" + img.path.split('/').pop()?.replace(/\.[^.]+$/, '');
    return usedIds.has(itemId);
  }) : images;
  
  // itemManagerが指定されている場合、存在するアイテムのみにフィルタリング（並列化）
  if (itemManager && versionId) {
    let itemMap = new Set<string>();
    let items3d = new Set<string>();

    // 3Dアイテムリストを取得（キャッシュがあれば使用、なければ空配列）
    const items3dList = await itemManager.get3DItemsLazy(versionId);
    items3dList.forEach(id => items3d.add(id));

    // usedIds が指定されている場合のみテクスチャパスを並列取得
    if (usedIds && usedIds.size > 0) {
      const itemMapPromises = Array.from(usedIds).map(async (itemId) => {
        try {
          const texturePath = await itemManager.getItemTexturePath(versionId, itemId);
          if (texturePath) {
            return itemId;
          }
        } catch (error) {
          // テクスチャパス取得エラーは無視
        }
        return null;
      });

      const results = await Promise.all(itemMapPromises);
      for (const itemId of results) {
        if (itemId) {
          itemMap.add(itemId);
        }
      }
    } else if (!usedIds) {
      // usedIdsがない場合は、フィルタード画像からのみマップを生成
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
    }

    // 3DアイテムをitemMapに追加
    const allItems = new Set([...itemMap, ...items3d]);

    return format(
      `
  type Files = %s;
  %s
  export const resourcePack: Readonly<Record<Files, string>>;
  export default resourcePack;
      `
        .replace(/^\n/, '')
        .replace(/[ \t]+$/, ''),
      allItems.size > 0 ? Array.from(allItems).map((item) => `"${item}"`).join(' | ') : '""',
      allItems.size > 0 ? 'export function getResourcePack(path: Files): string;' : ''
    );
  } else {
    return format(
      `
  type Files = %s;
  %s
  export const resourcePack: Readonly<Record<Files, string>>;
  export default resourcePack;
      `
        .replace(/^\n/, '')
        .replace(/[ \t]+$/, ''),
      filteredImages.length > 0 ? filteredImages.map((img) => `"${img.path}"`).join(' | ') : '""',
      filteredImages.length > 0 ? 'export function getResourcePack(path: Files): string;' : ''
    );
  }
}
