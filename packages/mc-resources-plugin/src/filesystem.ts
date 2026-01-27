import { readdirSync, statSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, relative, extname, resolve } from 'node:path';

/**
 * resourcePackPath/assets/minecraft 内のすべての画像ファイルを再帰的に取得
 */
export function getAllImages(resourcePackPath: string) {
  const images: Array<{ path: string; relativePath: string }> = [];
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
 * 出力ディレクトリを初期化
 */
export function initializeOutputDirectory(outputPath: string, emptyOutDir: boolean): void {
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
}

/**
 * ファイルをディスクに書き込む
 */
export function writeFiles(outputPath: string, jsCode: string, tsCode: string): void {
  // JSファイルを生成
  const jsFilePath = join(outputPath, 'resourcepack.js');
  writeFileSync(jsFilePath, jsCode, 'utf-8');

  // 型定義ファイルを生成
  const dtsFilePath = join(outputPath, 'resourcepack.d.ts');
  writeFileSync(dtsFilePath, tsCode, 'utf-8');
}
