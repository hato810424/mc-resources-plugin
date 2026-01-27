import { readFileSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import type { ImageInfo } from './types';
import { format } from 'node:util';

/**
 * Base64形式の画像マップを生成
 */
function generateBase64ImageMap(images: ImageInfo[], resourcePackPath: string): string {
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
      return `    "${img.path}": "data:${mimeType[ext] || 'image/png'};base64,${base64}",`;
    })
    .join('\n');
}

/**
 * import形式の画像マップを生成
 */
function generateImportStatements(images: ImageInfo[], resourcePackPath: string): string {
  return images
    .map((img, index) => {
      const absolutePath = join(resolve(resourcePackPath), 'assets', 'minecraft', img.relativePath);
      const fileUrl = new URL(`file://${absolutePath}`).href;
      return `import _i${index} from "${fileUrl}?import";`;
    })
    .join('\n');
}

/**
 * import形式の画像マップを生成
 */
function generateImportImageMap(images: ImageInfo[]): string {
  return images
    .map((img, index) => {
      return `    "${img.path}": _i${index},`;
    })
    .join('\n');
}

/**
 * 画像情報から getMcResources 関数を生成
 */
export function generateGetResourcePackCode({
  images,
  resourcePackPath,
  isBase64,
  usedPaths,
}: {
  images: ImageInfo[];
  resourcePackPath: string;
  isBase64: boolean;
  usedPaths?: Set<string>;
}): string {
  // usedPathsが指定されている場合、使用されている画像のみフィルタリング
  const filteredImages = usedPaths ? images.filter(img => usedPaths.has(img.path)) : images;

  let imports: string;
  let imageMap: string;

  if (isBase64) {
    imports = '';
    imageMap = generateBase64ImageMap(filteredImages, resourcePackPath);
  } else {
    imports = generateImportStatements(filteredImages, resourcePackPath);
    imageMap = generateImportImageMap(filteredImages);
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
export function generateTypeDefinitions(images: ImageInfo[], usedPaths?: Set<string>): string {
  const filteredImages = usedPaths ? images.filter(img => usedPaths.has(img.path)) : images;

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
