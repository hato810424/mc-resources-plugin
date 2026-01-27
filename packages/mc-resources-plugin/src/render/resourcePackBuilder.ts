import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { MinecraftPathResolver, MINECRAFT_PATHS } from './paths';

/**
 * リソースパック内のモデルやテクスチャを解析・管理するモジュール
 * https://github.com/TABmk/minecraft-blocks-render を参考に実装
 */

export interface ResolvedTexture {
  path: string;
  dataUrl?: string | null;
  mcmeta?: any | null;
}

export interface ResolvedModel {
  name: string;
  model: any;
  sourceModel: any;
  usedTextures: ResolvedTexture[];
}

export interface ResolvedItem {
  name: string;
  definition: any;
  modelReference: string | null;
  textureInfo: {
    texturePath: string | null;
    dataUrl?: string | null;
    mcmeta?: any | null;
  };
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

/**
 * テクスチャ参照を解決（#texture_nameのような参照を実際のパスに変換）
 */
function resolveTexturePath(
  textures: Record<string, string> = {},
  ref: string | null | undefined,
  visited = new Set<string>()
): string | null {
  if (!ref) return null;
  if (visited.has(ref)) return null;

  if (ref.startsWith('#')) {
    const key = ref.slice(1);
    visited.add(ref);
    return resolveTexturePath(textures, textures[key], visited);
  }

  // MinecraftPathResolver を使用して正規化
  const pathResolver = new MinecraftPathResolver('');
  const texturePath = pathResolver.normalizeTexturePath(ref);
  return `${MINECRAFT_PATHS.minecraft}/${texturePath}`;
}

/**
 * モデル参照を再帰的に検索
 */
function findModelReference(node: any): string | null {
  if (!node || typeof node !== 'object') return null;

  // type: 'minecraft:model' 形式
  if (node.type === 'minecraft:model' && typeof node.model === 'string') {
    return node.model;
  }

  // fallback処理
  if (node.fallback) {
    const fallbackFound = findModelReference(node.fallback);
    if (fallbackFound) return fallbackFound;
  }

  // cases配列
  if (Array.isArray(node.cases)) {
    for (const entry of node.cases) {
      const found = findModelReference(entry?.model ?? entry);
      if (found) return found;
    }
  }

  // entries配列
  if (Array.isArray(node.entries)) {
    for (const entry of node.entries) {
      const found = findModelReference(entry?.model ?? entry);
      if (found) return found;
    }
  }

  // 配列そのもの
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findModelReference(entry);
      if (found) return found;
    }
    return null;
  }

  // オブジェクトのすべての値を再帰的に検索
  for (const value of Object.values(node)) {
    const found = findModelReference(value);
    if (found) return found;
  }

  return null;
}

export class ResourcePackBuilder {
  private modelsCache = new Map<string, any>();
  private resolvedModelCache = new Map<string, any>();
  private pathResolver: MinecraftPathResolver;

  constructor(resourcePackPath: string) {
    this.pathResolver = new MinecraftPathResolver(resourcePackPath);
  }

  /**
   * リソースパック内のすべてのブロックモデルを構築
   */
  async buildAllModels(): Promise<ResolvedModel[]> {
    const modelsDir = this.pathResolver.getBlockModelsDir();

    if (!existsSync(modelsDir)) {
      console.warn(`Models directory not found: ${modelsDir}`);
      return [];
    }

    const files = await readdir(modelsDir);
    const modelFiles = files.filter((f) => f.endsWith('.json'));

    // モデルをマップに読み込む
    for (const file of modelFiles) {
      const name = file.slice(0, -5); // .json を削除
      const filePath = join(modelsDir, file);
      try {
        const content = await readFile(filePath, 'utf-8');
        this.modelsCache.set(name, JSON.parse(content));
      } catch (error) {
        console.warn(`Failed to load model ${name}:`, error);
      }
    }

    const resolvedModels: ResolvedModel[] = [];

    for (const name of this.modelsCache.keys()) {
      const resolvedModel = this.resolveModel(name);
      if (!resolvedModel) continue;

      const elements = resolvedModel.elements || [];
      const usedTextures = new Map<string, ResolvedTexture>();

      for (const element of elements) {
        const faces = element.faces || {};
        for (const [, faceDef] of Object.entries(faces)) {
          const texturePath = resolveTexturePath(resolvedModel.textures || {}, (faceDef as any)?.texture);
          if (texturePath && !usedTextures.has(texturePath)) {
            usedTextures.set(texturePath, {
              path: texturePath,
              dataUrl: null,
              mcmeta: null,
            });
          }
        }
      }

      resolvedModels.push({
        name,
        model: resolvedModel,
        sourceModel: clone(this.modelsCache.get(name)),
        usedTextures: Array.from(usedTextures.values()),
      });
    }

    resolvedModels.sort((a, b) => a.name.localeCompare(b.name));
    return resolvedModels;
  }

  /**
   * すべてのアイテムを構築
   */
  async buildAllItems(): Promise<ResolvedItem[]> {
    const itemsDir = this.pathResolver.getItemsDir();

    if (!existsSync(itemsDir)) {
      console.warn(`Items directory not found: ${itemsDir}`);
      return [];
    }

    const files = await readdir(itemsDir);
    const itemFiles = files.filter((f) => f.endsWith('.json'));

    const resolvedItems: ResolvedItem[] = [];

    for (const file of itemFiles) {
      const name = file.slice(0, -5); // .json を削除
      const filePath = join(itemsDir, file);

      try {
        const content = await readFile(filePath, 'utf-8');
        const definition = JSON.parse(content);

        const modelReference = findModelReference(definition?.model ?? definition);
        const normalized = modelReference?.replace(/^minecraft:/, '');
        const isBlockModel = normalized?.startsWith('block/');
        const itemTextureName = normalized?.startsWith('item/') ? normalized.slice('item/'.length) : name;
        const texturePath = `assets/minecraft/textures/item/${itemTextureName}.png`;

        resolvedItems.push({
          name,
          definition,
          modelReference: normalized ?? null,
          textureInfo: {
            texturePath: isBlockModel ? null : texturePath,
            dataUrl: null,
            mcmeta: null,
          },
        });
      } catch (error) {
        console.warn(`Failed to load item ${name}:`, error);
      }
    }

    resolvedItems.sort((a, b) => a.name.localeCompare(b.name));
    return resolvedItems;
  }

  /**
   * モデルとその親の継承を解決
   */
  private resolveModel(name: string, chain = new Set<string>()): any {
    if (this.resolvedModelCache.has(name)) {
      return this.resolvedModelCache.get(name);
    }

    if (chain.has(name)) {
      return null;
    }
    chain.add(name);

    const baseModel = this.modelsCache.get(name);
    if (!baseModel) {
      return null;
    }

    const model = clone(baseModel);

    if (model.parent) {
      let parentName = model.parent.replace(/^minecraft:/, '');
      if (parentName.startsWith('block/')) {
        parentName = parentName.slice('block/'.length);
      }
      const parentModel = this.resolveModel(parentName, chain);
      if (parentModel) {
        model.textures = {
          ...(parentModel.textures || {}),
          ...(model.textures || {}),
        };
        if (!model.elements && parentModel.elements) {
          model.elements = clone(parentModel.elements);
        }
      }
    }

    this.resolvedModelCache.set(name, model);
    return model;
  }

  /**
   * キャッシュをクリア
   */
  clearCache() {
    this.modelsCache.clear();
    this.resolvedModelCache.clear();
  }
}
