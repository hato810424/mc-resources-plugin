import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchesPattern } from './patternMatcher';

/**
 * ソースコードをスキャンして、使用されているMinecraft IDを検出
 */
export function scanSourceCode(
  root: string,
  options: {
    include?: string[];
    exclude?: string[];
    outputPath?: string;
    viteOutDir?: string;
  } = {}
): Set<string> {
  const {
    include = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    exclude = [],
    outputPath = './mcpacks',
    viteOutDir = './dist',
  } = options;

  const usedIds = new Set<string>();

  
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
            extractResourceIds(fullPath, usedIds);
          }
        }
      }
    } catch {
      // ディレクトリスキャンエラーを無視
    }
  };

  scanDir(root);
  return usedIds;
}

/**
 * ファイルからMinecraft IDを抽出
 */
function extractResourceIds(filePath: string, usedIds: Set<string>): void {
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
  } catch {
    // ファイル読み込みエラーを無視
  }
}
