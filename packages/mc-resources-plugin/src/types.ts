export interface PluginOptions {
  resourcePackPath: string;
  outputPath?: string;
  emptyOutDir?: boolean;
  include?: string[]; // grep形式のファイルパターン (例: ['**/*.ts', '**/*.tsx'])
  exclude?: string[]; // grep形式の除外パターン (例: ['node_modules', 'dist', '.git'])
}

export interface ImageInfo {
  path: string;
  relativePath: string;
}
