import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchesPattern } from './patternMatcher';

/**
 * ソースコードをスキャンして、使用されている画像パスを検出
 */
export function scanSourceCode(
  root: string,
  options: {
    include?: string[];
    exclude?: string[];
    outputPath?: string;
  } = {}
): Set<string> {
  const {
    include = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    exclude = [],
    outputPath = './mcpacks',
  } = options;

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
            extractImagePaths(fullPath, usedPaths);
          }
        }
      }
    } catch {
      // ディレクトリスキャンエラーを無視
    }
  };

  scanDir(root);
  return usedPaths;
}

/**
 * ファイルから画像パスを抽出
 */
function extractImagePaths(filePath: string, usedPaths: Set<string>): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
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
