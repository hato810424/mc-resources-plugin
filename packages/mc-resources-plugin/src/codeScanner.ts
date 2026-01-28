import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchesPattern } from './patternMatcher';
import { CONFIG } from './env';

export type RenderingOption = {
  itemId: string;
  optionHash: string;
  width?: number;
  height?: number;
  scale?: number;
};

export type ScanResult = {
  usedIds: Set<string>;
  renderingOptions: Map<string, RenderingOption>;
};

/**
 * ソースコードをスキャンして、使用されているMinecraft IDとレンダリングオプションを検出
 */
export function scanSourceCode(
  root: string,
  options: {
    include?: string[];
    exclude?: string[];
    outputPath?: string;
    viteOutDir?: string;
  } = {}
): ScanResult {
  const {
    include = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    exclude = [],
    outputPath = './mcpacks',
    viteOutDir = './dist',
  } = options;

  const usedIds = new Set<string>();
  const renderingOptions = new Map<string, RenderingOption>();

  
  // 常に除外する必須パターン
  const alwaysExclude = ['node_modules', '.git', '*.d.ts'];
  // 出力パスも除外する
  const normalizedOutputPath = outputPath.replace(/^\.\//, '').replace(/\/$/, '');
  const normalizedViteOutDir = viteOutDir.replace(/^\.\//, '').replace(/\/$/, '');
  const finalExclude = [...alwaysExclude, normalizedOutputPath, normalizedViteOutDir, ...exclude];

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
            extractResourceIds(fullPath, usedIds, renderingOptions);
          }
        }
      }
    } catch {
      // ディレクトリスキャンエラーを無視
    }
  };

  scanDir(root);
  return { usedIds, renderingOptions };
}

/**
 * オプションのハッシュキーを生成
 */
function generateOptionHash(width?: number, height?: number, scale?: number): string {
  const parts = [];
  if (width !== undefined) parts.push(`w${width}`);
  if (height !== undefined) parts.push(`h${height}`);
  if (scale !== undefined) parts.push(`s${scale}`);
  return parts.join('_');
}

/**
 * ファイルからMinecraft IDを抽出
 */
function extractResourceIds(
  filePath: string,
  usedIds: Set<string>,
  renderingOptions: Map<string, RenderingOption>
): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
    // minecraft:item/diamond のようなID参照を検出（文字列リテラル内のみ）
    // パターン1: "minecraft:xxx"
    const doubleQuoteRegex = /"minecraft:([a-z0-9/_\-\.]+)"/gi;
    let match;
    while ((match = doubleQuoteRegex.exec(content)) !== null) {
      const id = `minecraft:${match[1]}`;
      usedIds.add(id);
    }
    
    // パターン2: 'minecraft:xxx'
    const singleQuoteRegex = /'minecraft:([a-z0-9/_\-\.]+)'/gi;
    while ((match = singleQuoteRegex.exec(content)) !== null) {
      const id = `minecraft:${match[1]}`;
      usedIds.add(id);
    }

    // getResourcePack()のオプション抽出
    // パターン1: getResourcePack("minecraft:xxx", { width: 256, height: 256, scale: 2 })
    const resourcePackRegex = /getResourcePack\s*\(\s*["']minecraft:([a-z0-9/_\-\.]+)["']\s*,\s*\{\s*([^}]*)\s*\}\s*\)/gi;
    while ((match = resourcePackRegex.exec(content)) !== null) {
      const itemId = `minecraft:${match[1]}`;
      const optionsStr = match[2];
      let width: number | undefined;
      let height: number | undefined;
      let scale: number | undefined;

      // width, height, scale を抽出
      const widthMatch = /width\s*:\s*(\d+)/.exec(optionsStr);
      const heightMatch = /height\s*:\s*(\d+)/.exec(optionsStr);
      const scaleMatch = /scale\s*:\s*([\d.]+)/.exec(optionsStr);

      if (widthMatch) {
        width = parseInt(widthMatch[1], 10);
      }
      if (heightMatch) {
        height = parseInt(heightMatch[1], 10);
      }
      if (scaleMatch) {
        scale = parseFloat(scaleMatch[1]);
      }

      // オプションが存在する場合のみマップに追加
      if (width || height || scale) {
        const optionHash = generateOptionHash(width, height, scale);
        const uniqueKey = `${itemId}:${optionHash}`;
        
        // 同じ組み合わせは一度だけ追加
        if (!renderingOptions.has(uniqueKey)) {
          renderingOptions.set(uniqueKey, {
            itemId,
            optionHash,
            width,
            height,
            scale,
          });
        }
      }
    }

    // パターン2: getResourcePack("minecraft:xxx") - オプション無し（パターン1にマッチしないもの）
    // lookahead を使ってパターン1と被らないようにする
    const resourcePackNoOptionRegex = /getResourcePack\s*\(\s*["']minecraft:([a-z0-9/_\-\.]+)["']\s*(?!\s*,\s*\{)(?=\s*\))/gi;
    const processedItemsForNoOption = new Set<string>();
    while ((match = resourcePackNoOptionRegex.exec(content)) !== null) {
      const itemId = `minecraft:${match[1]}`;
      
      // オプション無しで初めて検出される場合のみ追加
      // （オプション付きで既に検出されていてもデフォルト版は別に追加）
      if (!processedItemsForNoOption.has(itemId)) {
        const uniqueKey = `${itemId}:default`;
        if (!renderingOptions.has(uniqueKey)) {
          renderingOptions.set(uniqueKey, {
            itemId,
            optionHash: 'default',
            width: CONFIG.WIDTH,
            height: CONFIG.HEIGHT,
          });
        }
        processedItemsForNoOption.add(itemId);
      }
    }
  } catch {
    // ファイル読み込みエラーを無視
  }
}
