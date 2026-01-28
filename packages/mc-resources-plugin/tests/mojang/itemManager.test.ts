import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createItemManager } from '../../src/mojang/itemManager';
import { createVersionManager } from '../../src/mojang/minecraftVersionManager';
import findCacheDirectory from 'find-cache-directory';

describe('ItemManager', () => {
  let cacheDir: string;
  let versionId = 'latest';

  beforeAll(() => {
    cacheDir = findCacheDirectory({
      name: '@hato810424/mc-resources-plugin-test',
      create: true,
    })!;
  });

  afterAll(() => {
    // テスト後のクリーンアップ（オプション）
    // rmSync(cacheDir, { recursive: true, force: true });
  });

  it('should create an ItemManager instance', () => {
    const versionManager = createVersionManager(cacheDir);
    const itemManager = createItemManager(versionManager);
    expect(itemManager).toBeDefined();
  });

  it('should get item IDs from en_us.json', async () => {
    const versionManager = createVersionManager(cacheDir);
    const itemManager = createItemManager(versionManager);

    const itemIds = await itemManager.getItemIds(versionId);
    expect(Array.isArray(itemIds)).toBe(true);
    expect(itemIds.length).toBeGreaterThan(0);
    expect(itemIds).toContain('stone');
    expect(itemIds).toContain('dirt');
  });

  it('should get item label in en_us', async () => {
    const versionManager = createVersionManager(cacheDir);
    const itemManager = createItemManager(versionManager);

    const label = await itemManager.getItemLabel(versionId, 'stone', 'en_us');
    expect(label).toBeDefined();
    expect(label).not.toBe('stone'); // 実際のラベルが返されるはず
  });

  it('should get item labels in multiple languages', async () => {
    const versionManager = createVersionManager(cacheDir);
    const itemManager = createItemManager(versionManager);

    const labels = await itemManager.getItemLabelsByLangs(versionId, 'stone', [
      'en_us',
      'ja_jp',
    ]);
    expect(labels).toBeDefined();
    expect(labels['en_us']).toBeDefined();
    expect(labels['ja_jp']).toBeDefined();
  });

  it('should cache language files', async () => {
    const versionManager = createVersionManager(cacheDir);
    const itemManager = createItemManager(versionManager);

    // 1回目の呼び出し
    const startTime1 = Date.now();
    await itemManager.getItemLabel(versionId, 'stone', 'en_us');
    const duration1 = Date.now() - startTime1;

    // 2回目の呼び出し（キャッシュから）
    const startTime2 = Date.now();
    await itemManager.getItemLabel(versionId, 'stone', 'en_us');
    const duration2 = Date.now() - startTime2;

    // キャッシュの方が速いはず
    expect(duration2).toBeLessThanOrEqual(duration1);
  });
});
