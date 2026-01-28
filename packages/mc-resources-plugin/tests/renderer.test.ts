import { describe, it, expect, beforeAll } from 'vitest';
import { createResourcePack, type MinecraftResourcePack } from '../src/render/ResourcePack';
import { join, resolve } from 'path';
import { accessSync } from 'fs';

const __dirname = import.meta.dirname;

describe('MinecraftResourcePack', () => {
  let resourcePack: MinecraftResourcePack;
  const resourcePackPath = resolve(__dirname, './assets/resource-pack');
  const outputDir = resolve(__dirname, './dist/renders');

  beforeAll(() => {
    resourcePack = createResourcePack(resourcePackPath);
  });

  it('すべてのブロックモデルを取得できる', async () => {
    const allModels = await resourcePack.getAllBlockModels();
    expect(allModels).toBeDefined();
    expect(Array.isArray(allModels)).toBe(true);
    expect(allModels.length).toBeGreaterThan(0);
  });

  it('特定のブロックモデルの詳細を取得できる', async () => {
    const stoneModel = await resourcePack.getBlockModel('stone');
    expect(stoneModel).toBeDefined();
    if (stoneModel) {
      expect(stoneModel.model).toBeDefined();
      expect(stoneModel.usedTextures).toBeDefined();
      expect(Array.isArray(stoneModel.usedTextures)).toBe(true);
    }
  });

  it('ブロックのテクスチャを取得できる', async () => {
    const stoneTextures = await resourcePack.getModelTextures('stone');
    expect(stoneTextures).toBeDefined();
    expect(Array.isArray(stoneTextures)).toBe(true);
  });

  it('複数のブロックをレンダリングできる', async () => {
    const sampleBlocks = ['minecraft:stone', 'minecraft:anvil', 'minecraft:dispenser', 'minecraft:white_stained_glass'];

    const renderResult = await resourcePack.renderBlocks(sampleBlocks, {
      outputDir,
      width: 128,
    });

    expect(renderResult).toBeDefined();
    expect(renderResult.success).toBeDefined();
    expect(renderResult.failed).toBeDefined();
    expect(Array.isArray(renderResult.success)).toBe(true);
    expect(Array.isArray(renderResult.failed)).toBe(true);

    // minecraft: プレフィックスが削除されたファイルが生成されることを確認
    expect(() => {
      for (const block of sampleBlocks) {
        accessSync(join(outputDir, `${block.replace('minecraft:', '').replace(/:/g, '-')}.png`));
      }
    }).not.toThrow()
  });
});
