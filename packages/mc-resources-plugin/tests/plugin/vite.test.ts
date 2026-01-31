import { expect, test, describe } from 'vitest'
import mcResourcesPlugin from '../../src/plugin/vite'
import { build } from 'vite'
import { accessSync, readFileSync } from 'node:fs'
import { join } from 'node:path';

describe('mc-resources-plugin', () => {
  test('should generate resource pack files', { timeout: 60000 }, async () => {
    const outDir = 'tests/dist/vite';
    const mcpacksDir = 'tests/dist/mcpacks';
    const mcpacksEmptyDir = 'tests/dist/mcpacks-empty';

    await build({
      logLevel: 'silent',
      plugins: [
        await mcResourcesPlugin({
          resourcePackPath: 'tests/assets/resource-pack',
          mcVersion: '1.18.2',
          outputPath: 'tests/dist/mcpacks',
          emptyOutDir: true,
          include: ['example.ts', 'exclude_dir/example.ts'],
          exclude: ["dist", 'exclude_dir'],
        }),
        await mcResourcesPlugin({
          resourcePackPath: 'tests/assets/resource-pack-empty',
          mcVersion: '1.18.2',
          outputPath: 'tests/dist/mcpacks-empty',
          emptyOutDir: true,
          include: [],
          exclude: ['dist'],
        }),
      ],
      build: {
        lib: {
          entry: ['tests/example.ts'],
          formats: ['es'],
          fileName: 'input',
        },
        outDir: 'tests/dist/vite',
        emptyOutDir: true,
      }
    })
    
    expect(
      accessSync(join(outDir, 'input.js'))
    ).toBeUndefined()

    // Check that the generated JS file exists and contains expected content
    const jsContent = readFileSync(join(mcpacksDir, 'resourcepack.mjs'), 'utf-8')
    expect(jsContent).toContain('./rendered-items/cake.png')
    expect(jsContent).not.toContain('./rendered-items/arrow.png')

    // Check that the generated d.ts file exists and contains expected content
    const dtsContent = readFileSync(join(mcpacksDir, 'resourcepack.d.ts'), 'utf-8')
    expect(dtsContent).toContain('export function getResourcePack')
    expect(dtsContent).toContain('minecraft:cake')

    // Check empty resource pack
    const jsContentEmpty = readFileSync(join(mcpacksEmptyDir, 'resourcepack.mjs'), 'utf-8')
    expect(jsContentEmpty).not.toContain('./rendered-items/cake.png')
  });
});
