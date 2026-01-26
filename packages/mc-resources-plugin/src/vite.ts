import { createVitePlugin } from 'unplugin';
import { readdirSync, statSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, relative, extname, resolve } from 'node:path';
import { format } from 'node:util';

interface PluginOptions {
  resourcePackPath: string;
  outputPath?: string;
  emptyOutDir?: boolean;
  include?: string[]; // grep形式のファイルパターン (例: ['**/*.ts', '**/*.tsx'])
  exclude?: string[]; // grep形式の除外パターン (例: ['node_modules', 'dist', '.git'])
}

interface ImageInfo {
  path: string;
  relativePath: string;
}

/**
 * resourcePackPath/assets/minecraft 内のすべての画像ファイルを再帰的に取得
 */
function getAllImages(resourcePackPath: string): ImageInfo[] {
  const images: ImageInfo[] = [];
  const minecraftPath = join(resourcePackPath, 'assets', 'minecraft');

  function walkDir(currentPath: string, basePath: string) {
    try {
      const entries = readdirSync(currentPath);

      for (const entry of entries) {
        const fullPath = join(currentPath, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          walkDir(fullPath, basePath);
        } else {
          const ext = extname(entry).toLowerCase();
          // 画像ファイルのみを対象
          if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
            const relativePath = relative(basePath, fullPath).replace(/\\/g, '/');
            images.push({
              path: `/${relativePath}`,
              relativePath,
            });
          }
        }
      }
    } catch {
      // ディレクトリが存在しない場合など
    }
  }

  walkDir(minecraftPath, minecraftPath);
  return images;
}

/**
 * 画像情報から getMcResources 関数を生成
 */
function generateGetResourcePackCode({
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
  let imageMap: string;
  let imports: string;

  // usedPathsが指定されている場合、使用されている画像のみフィルタリング
  const filteredImages = usedPaths ? images.filter(img => usedPaths.has(img.path)) : images;

  if (isBase64) {
    imports = "";
    imageMap = filteredImages
      .map((img, index) => {
        const absolutePath = join(resolve(resourcePackPath), 'assets', 'minecraft', img.relativePath);
        const imageData = readFileSync(absolutePath);
        const base64 = imageData.toString('base64');
        const ext = extname(img.path).toLowerCase();
        const mimeType = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
        }[ext] || 'image/png';
        return `    "${img.path}": "data:${mimeType};base64,${base64}",`;
      })
      .join('\n');
  } else {
    imports = filteredImages
      .map((img, index) => {
        const absolutePath = join(resolve(resourcePackPath), 'assets', 'minecraft', img.relativePath)
        const fileUrl = new URL(`file://${absolutePath}`).href;
        
        return `import _i${index} from "${fileUrl}?import";`;
      })
      .join('\n');

    imageMap = filteredImages
      .map((img, index) => {
        return `    "${img.path}": _i${index},`;
      })
      .join('\n');
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
function generateTypeDefinitions(images: ImageInfo[], usedPaths?: Set<string>): string {
  const filteredImages = usedPaths ? images.filter(img => usedPaths.has(img.path)) : images;
  
  return format(`
type Files = %s;
%s
export const resourcePack: Readonly<Record<Files, string>>;
export default resourcePack;
    `.replace(/^\n/, "")
    .replace(/[ \t]+$/, ""),
    filteredImages.length > 0 ? filteredImages.map((img) => `"${img.path}"`).join(' | ') : '""',
    filteredImages.length > 0 ? 'export function getResourcePack(path: Files): string;' : '',
  );
}

const mcResourcesPlugin = createVitePlugin((options: PluginOptions) => {
  const { 
    resourcePackPath, 
    outputPath = './mcpacks', 
    emptyOutDir = false,
    include = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'], // デフォルト: TypeScript/JavaScript
    exclude = []
  } = options;
  let isGenerated = false;

  // grep形式のパターンマッチング
  const matchesPattern = (path: string, patterns: string[]): boolean => {
    const pathParts = path.split('/');
    
    return patterns.some(pattern => {
      // シンプルなglob実装
      const regex = new RegExp(
        '^' + pattern
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '.+')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '[^/]') + '$'
      );
      
      // スラッシュが含まれないパターンの場合、パスのいずれかのコンポーネントでマッチをチェック
      if (!pattern.includes('/')) {
        return pathParts.some(part => regex.test(part));
      }
      
      // スラッシュが含まれるパターンの場合、完全パスでマッチをチェック
      return regex.test(path);
    });
  };

  // ソースコードをスキャンして、使用されている画像パスを検出
  const scanSourceCode = (root: string): Set<string> => {
    const usedPaths = new Set<string>();
    // 常に除外する必須パターン
    const alwaysExclude = ['node_modules', '.git', '*.d.ts'];
    // 出力パスも除外する
    const normalizedOutputPath = outputPath.replace(/^\.\//, '').replace(/\/$/, '');
    const finalExclude = [...alwaysExclude, normalizedOutputPath, ...exclude];
    
    const scanDir = (dir: string, relativeBase: string = '') => {
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          const relativePath = relativeBase ? `${relativeBase}/${entry}` : entry;
          const stat = statSync(fullPath);
          
          // 除外パターンにマッチしたら処理をスキップ
          if (matchesPattern(relativePath, finalExclude)) {
            continue;
          }
          
          if (stat.isDirectory()) {
            scanDir(fullPath, relativePath);
          } else if (stat.isFile()) {
            // includeパターンにマッチしたファイルのみ処理
            if (matchesPattern(relativePath, include)) {
              try {
                const content = readFileSync(fullPath, 'utf-8');
                // 画像ファイルパスを検出（複数のパターン対応）
                // パターン1: getResourcePack('/path/to/image.png')
                // パターン2: ('/path/to/image.png')のような直接参照
                const pathRegex = /(?:getResourcePack|['"])\s*\(\s*['"]([/]?[^'"]*\.(?:png|jpg|jpeg|gif|webp))["']\s*\)/gi;
                let match;
                while ((match = pathRegex.exec(content)) !== null) {
                  const path = match[1].startsWith('/') ? match[1] : `/${match[1]}`;
                  usedPaths.add(path);
                }
              } catch {
                // ファイル読み込みエラーを無視
              }
            }
          }
        }
      } catch {
        // ディレクトリスキャンエラーを無視
      }
    };
    
    scanDir(root);
    return usedPaths;
  };

  // ファイル生成関数
  const generateFiles = ({
    usedImagePaths = undefined,
    isBase64 = false
  } : {
    usedImagePaths?: Set<string>,
    isBase64?: boolean
  }) => {
    if (isGenerated) return; // 既に生成済みの場合スキップ

    const images = getAllImages(resourcePackPath);
    const jsCode = generateGetResourcePackCode({ images, resourcePackPath, isBase64, usedPaths: usedImagePaths });
    const tsCode = generateTypeDefinitions(images, usedImagePaths);

    // 出力ディレクトリを空にする
    if (emptyOutDir && existsSync(outputPath)) {
      rmSync(outputPath, { recursive: true });
      mkdirSync(outputPath, { recursive: true });
    }

    // ディレクトリを作成
    try {
      mkdirSync(outputPath, { recursive: true });
    } catch {
      // ディレクトリ作成エラーを無視
    }

    // JSファイルを生成
    const jsFilePath = join(outputPath, 'resourcepack.js');
    writeFileSync(jsFilePath, jsCode, 'utf-8');

    // 型定義ファイルを生成
    const dtsFilePath = join(outputPath, 'resourcepack.d.ts');
    writeFileSync(dtsFilePath, tsCode, 'utf-8');

    const displayCount = usedImagePaths ? usedImagePaths.size : images.length;
    console.log(`[mc-resources-plugin] Generated with ${displayCount} images (found ${images.length} total)`);

    isGenerated = true;
  };

  return {
    name: '@hato810424/mc-resources-plugin',

    vite: {
      configureServer() {
        // 開発サーバー起動時にファイルを生成（全画像）
        generateFiles({ isBase64: true });
      },

      buildStart() {
        // ビルド開始時に、使用されている画像をスキャン
        const root = process.cwd();
        const detectedPaths = scanSourceCode(root);
        generateFiles({ usedImagePaths: detectedPaths.size > 0 ? detectedPaths : undefined });
      },

      generateBundle() {
        // ビルド後の処理（必要に応じて）
      },
    },
  };
});

export default mcResourcesPlugin;
