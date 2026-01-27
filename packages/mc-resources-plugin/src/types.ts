export interface PluginOptions {
  resourcePackPath: string;
  outputPath?: string;
  emptyOutDir?: boolean;
  include?: string[]; // glob形式のファイルパターン (例: ['**/*.ts', '**/*.tsx'])
  exclude?: string[]; // glob形式の除外パターン (例: ['node_modules', 'dist/*',])
}

export interface ImageInfo {
  path: string;
  relativePath: string;
}
