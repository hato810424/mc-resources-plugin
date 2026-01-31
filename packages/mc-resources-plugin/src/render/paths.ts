import { join } from 'path';

/**
 * Minecraft リソースパックの標準ディレクトリ構造定義
 */
export const MINECRAFT_PATHS = {
  assets: 'assets',
  minecraft: 'assets/minecraft',
  models: 'assets/minecraft/models',
  modelBlocks: 'assets/minecraft/models/block',
  textures: 'assets/minecraft/textures',
  textureBlocks: 'assets/minecraft/textures/block',
  textureItems: 'assets/minecraft/textures/item',
  items: 'assets/minecraft/items',
} as const;

export const TEXTURE_EXTENSIONS = ['.png', '.jpg', '.jpeg'] as const;

/**
 * Minecraft パス正規化・解析のユーティリティ
 */
export class MinecraftPathResolver {
  constructor(private resourcePackPath: string) {}

  /**
   * モデルパスを正規化
   * 例: minecraft:block/cube -> block/cube
   *     block/cube -> block/cube
   *     /path/to/block/cube.json -> block/cube
   */
  normalizeModelPath(modelPath: string): string {
    let normalized = modelPath
      .replace(/^minecraft:/, '')
      .replace(/\.json$/, '');

    if (!normalized.startsWith('block/') && !normalized.startsWith('item/')) {
      normalized = `block/${normalized}`;
    }
    return normalized;
  }

  /**
   * テクスチャ参照を正規化（相対パスのみ返す）
   * 例: minecraft:block/stone -> block/stone.png
   *     stone -> block/stone.png
   *     item/apple -> item/apple.png
   */
  normalizeTexturePath(texturePath: string): string {
    let normalized = texturePath
      .replace(/^minecraft:/, '')
      .replace(/^textures\//, '');

    // ディレクトリプレフィックスがない場合は block/ を付与
    if (!normalized.startsWith('block/') && !normalized.startsWith('item/')) {
      normalized = `block/${normalized}`;
    }

    // 拡張子がない場合は .png を付与
    if (!TEXTURE_EXTENSIONS.some((ext) => normalized.endsWith(ext))) {
      normalized += '.png';
    }

    return normalized;
  }

  /**
   * リソースパック内の完全なモデルファイルパスを取得
   */
  getModelFilePath(modelPath: string): string {
    const normalized = this.normalizeModelPath(modelPath);
    return join(
      this.resourcePackPath,
      MINECRAFT_PATHS.models,
      `${normalized}.json`
    );
  }

  /**
   * リソースパック内の完全なテクスチャファイルパスを取得
   */
  getTextureFilePath(texturePath: string): string {
    const normalized = this.normalizeTexturePath(texturePath);
    return join(this.resourcePackPath, MINECRAFT_PATHS.textures, normalized);
  }

  /**
   * ブロックモデルディレクトリの完全パスを取得
   */
  getBlockModelsDir(): string {
    return join(this.resourcePackPath, MINECRAFT_PATHS.modelBlocks);
  }

  /**
   * アイテム定義ディレクトリの完全パスを取得
   */
  getItemsDir(): string {
    return join(this.resourcePackPath, MINECRAFT_PATHS.items);
  }

  /**
   * モデルの基本ディレクトリを取得
   */
  getModelsBaseDir(): string {
    return join(this.resourcePackPath, MINECRAFT_PATHS.models);
  }

  /**
   * テクスチャの基本ディレクトリを取得
   */
  getTexturesBaseDir(): string {
    return join(this.resourcePackPath, MINECRAFT_PATHS.textures);
  }
}
