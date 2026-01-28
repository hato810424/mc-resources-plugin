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
        return `import _i${index} from "${fileUrl}";`;
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
  items3dUrlMap,
}: {
  images: ImageInfo[];
  resourcePackPath: string;
  isBase64: boolean;
  usedIds?: Set<string>;
  itemManager?: ItemManager;
  versionId: string;
  items3dUrlMap?: Map<string, string>;
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
  } else if (!isBase64) {
    // itemManagerがない場合は、フィルタード画像から直接テクスチャパスを生成
    filteredImages.forEach(img => {
      const itemId = "minecraft:" + img.path.split('/').pop()?.replace(/\.[^.]+$/, '');
      // テクスチャパスを相対パスで設定
      itemMap[itemId] = `/textures/${img.path}`;
    });
  }

  let imports: string;
  let imageMap: string;

  if (isBase64) {
    imports = '';
    imageMap = await generateBase64ImageMap(filteredImages, resourcePackPath, itemMap);
  } else {
    imports = generateImportStatements(filteredImages, resourcePackPath, usedIds ?? new Set());
    
    // 全フィルタード画像をシンプルにマッピング（ただし3Dアイテムは除外）
    imageMap = filteredImages
      .map((img, index) => {
        const itemId = `minecraft:${img.path.split('/').pop()?.replace(/\.[^.]+$/, '')}`;
        // 3Dアイテムでない場合のみマッピングに追加
        if (!items3d.has(itemId)) {
          return `    "${itemId}": _i${index},`;
        }
        return null;
      })
      .filter(Boolean)
      .join('\n');
  }

  // 3Dアイテムのマッピングを追加
  let items3dImports = '';
  let items3dMap = '';
  const itemHashMap = new Map<string, Map<string, string>>(); // itemId -> (optionHash -> importVar)
  
  if (items3d.size > 0) {
    let importIndex = 0;
    
    // まずインポート文を生成し、各itemIdとオプションハッシュをマッピング
    if (items3dUrlMap) {
      for (const [key, renderedPath] of items3dUrlMap) {
        const parts = key.split('_');
        const itemId = parts[0]; // minecraft:xxx
        const optionHash = parts.slice(1).join('_') || 'default'; // オプションハッシュ、またはデフォルト
        
        const importVarName = `_r3d${importIndex}`;
        items3dImports += `import ${importVarName} from "${renderedPath}";\n`;
        
        if (!itemHashMap.has(itemId)) {
          itemHashMap.set(itemId, new Map());
        }
        itemHashMap.get(itemId)!.set(optionHash, importVarName);
        importIndex++;
      }
    }
    
    // リソースパックマッピングを生成
    const items3dEntries: string[] = [];
    for (const itemId of items3d) {
      const hashMap = itemHashMap.get(itemId);
      if (hashMap && hashMap.size > 0) {
        // ビルド時にレンダリングされた画像がある場合
        for (const [optionHash, importVar] of hashMap) {
          if (optionHash === 'default') {
            // デフォルトはそのままitemIdをキーに
            items3dEntries.push(`    "${itemId}": ${importVar}`);
          } else {
            // オプション付きは `itemId_optionHash` をキーに
            items3dEntries.push(`    "${itemId}_${optionHash}": ${importVar}`);
          }
        }
      } else {
        // ビルド時にレンダリングされない場合は、デフォルトのエンドポイント
        items3dEntries.push(`    "${itemId}": "/@hato810424:mc-resources-plugin/minecraft:${itemId.replace('minecraft:', '')}"`);
      }
    }
    items3dMap = items3dEntries.join(',\n');
  }

  // 最後のカンマを削除（オブジェクトの最後の要素にはカンマが不要）
  let finalMap = imageMap;
  if (items3dMap) {
    finalMap += items3dMap;
  }
  // 最後のカンマを削除
  if (finalMap.endsWith(',')) {
    finalMap = finalMap.slice(0, -1);
  }

  return `${items3dImports}${imports}

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

    const Items = itemMap;
    const renderItems = items3d;

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
