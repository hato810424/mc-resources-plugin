import type { PluginOptions } from '../types';
import { getAllImages, initializeOutputDirectory, writeFiles } from '../filesystem';
import { generateGetResourcePackCode, generateTypeDefinitions } from '../codeGenerator';
import { scanSourceCode } from '../codeScanner';
import type { PluginOption } from 'vite';
import defaultLogger from '../logger';

const mcResourcesPlugin = (options: PluginOptions) => {
  const {
    resourcePackPath,
    outputPath = './mcpacks',
    emptyOutDir = false,
    include = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    exclude = [],
  } = options;

  let isGenerated = false;

  /**
   * ファイル生成関数
   */
  const generateFiles = ({
    usedImagePaths = undefined,
    isBase64 = false,
  }: {
    usedImagePaths?: Set<string>;
    isBase64?: boolean;
  } = {}): void => {
    if (isGenerated) return; // 既に生成済みの場合スキップ

    const images = getAllImages(resourcePackPath);
    
    const jsCode = generateGetResourcePackCode({ images, resourcePackPath, isBase64, usedPaths: usedImagePaths });
    const tsCode = generateTypeDefinitions(images, usedImagePaths);

    // 出力ディレクトリを初期化
    initializeOutputDirectory(outputPath, emptyOutDir);

    // ファイルを書き込む
    writeFiles(outputPath, jsCode, tsCode);

    const displayCount = usedImagePaths ? usedImagePaths.size : images.length;
    defaultLogger.info(`Generated with ${displayCount} images (found ${images.length} total)`);

    isGenerated = true;
  };

  return {
    name: '@hato810424/mc-resources-plugin',

    buildStart: () => {
      generateFiles({ isBase64: true });
    },

    generateBundle: () => {

      // ビルド開始時に、使用されている画像をスキャン
      const root = process.cwd();
      const detectedPaths = scanSourceCode(root, { include, exclude, outputPath });
      generateFiles({ usedImagePaths: detectedPaths.size > 0 ? detectedPaths : undefined });
    },
  } satisfies PluginOption;
};

export default mcResourcesPlugin;
