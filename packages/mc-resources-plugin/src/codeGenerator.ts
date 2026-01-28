import { readFileSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import type { ImageInfo } from './types';
import type { ItemManager } from './mojang/itemManager';
import { format } from 'node:util';

/**
 * Base64形式の画像マップを生成
 */
function generateBase64ImageMap(images: ImageInfo[], resourcePackPath: string, itemMap: Record<string, string>): string {
  return images
    .map((img) => {
      const absolutePath = join(resolve(resourcePackPath), 'assets', 'minecraft', img.relativePath);
      const imageData = readFileSync(absolutePath);
      const base64 = imageData.toString('base64');
      const ext = extname(img.path).toLowerCase();
      const mimeType: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      };
      const itemId = "minecraft:" + img.path.split('/').pop()?.replace(/\.[^.]+$/, '');
      const itemPath = itemMap[itemId];
      if (itemPath) {
        return `    "${itemId}": "data:${mimeType[ext] || 'image/png'};base64,${base64}",`;
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

  // itemManagerが指定されている場合、存在するアイテムのみにフィルタリング
  const itemMap: Record<string, string> = {};
  for (const img of filteredImages) {
    const itemId = "minecraft:" + img.path.split('/').pop()?.replace(/\.[^.]+$/, '');

    if (itemId && itemManager) {
      const texturePath = await itemManager.getItemTexturePath(versionId, itemId);
      if (texturePath) {
        itemMap[itemId] = texturePath;
      }
    }
  }

  let imports: string;
  let imageMap: string;

  if (isBase64) {
    imports = '';
    imageMap = generateBase64ImageMap(filteredImages, resourcePackPath, itemMap);
  } else {
    imports = generateImportStatements(filteredImages, resourcePackPath, usedIds ?? new Set());
    imageMap = generateImportImageMap(filteredImages, itemMap);
  }

  return `${imports}

const resourcePack = {
${imageMap}
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
  
  // itemManagerが指定されている場合、存在するアイテムのみにフィルタリング
  if (itemManager && versionId) {
    let itemMap = new Set<string>();

    for (const img of filteredImages) {
      const itemId = "minecraft:" + img.path.split('/').pop()?.replace(/\.[^.]+$/, '');

      if (itemId) {
        const texturePath = await itemManager.getItemTexturePath(versionId, itemId);
        if (texturePath) {
          itemMap.add(itemId);
        }
      }
    }

    return format(
      `
  type Files = %s;
  %s
  export const resourcePack: Readonly<Record<Files, string>>;
  export default resourcePack;
      `
        .replace(/^\n/, '')
        .replace(/[ \t]+$/, ''),
      itemMap.size > 0 ? Array.from(itemMap).map((item) => `"${item}"`).join(' | ') : '""',
      itemMap.size > 0 ? 'export function getResourcePack(path: Files): string;' : ''
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
