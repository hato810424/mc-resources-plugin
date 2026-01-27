import { expect, test, describe } from 'vitest'
import mcResourcesPlugin from '../../src/plugin/vite'
import { build } from 'vite'
import { accessSync, readFileSync } from 'node:fs'
import { join } from 'node:path';

describe('mc-resources-plugin', () => {
  test('should generate resource pack files', async () => {
    const outDir = 'tests/dist/vite';
    const mcpacksDir = 'tests/dist/mcpacks';
    const mcpacksEmptyDir = 'tests/dist/mcpacks-empty';

    await build({
      logLevel: 'silent',
      plugins: [
        mcResourcesPlugin({
          resourcePackPath: 'tests/assets/resource-pack',
          outputPath: 'tests/dist/mcpacks',
          emptyOutDir: true,
          include: ['**/*.ts', '**/*.tsx'],
          exclude: ["dist", 'exclude_dir'],
        }),
        mcResourcesPlugin({
          resourcePackPath: 'tests/assets/resource-pack-empty',
          outputPath: 'tests/dist/mcpacks-empty',
          emptyOutDir: true,
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
    const jsContent = readFileSync(join(mcpacksDir, 'resourcepack.js'), 'utf-8')
    expect(jsContent).toContain('/textures/item/cake.png')
    expect(jsContent).not.toContain('/textures/item/arrow.png')

    // Check that the generated d.ts file exists and contains expected content
    const dtsContent = readFileSync(join(mcpacksDir, 'resourcepack.d.ts'), 'utf-8')
    expect(dtsContent).toContain('export function getResourcePack')
    expect(dtsContent).toContain('/textures/item/cake.png')

    // Check empty resource pack
    const jsContentEmpty = readFileSync(join(mcpacksEmptyDir, 'resourcepack.js'), 'utf-8')
    expect(jsContentEmpty).not.toContain('/textures/item/cake.png')

    const dtsContentEmpty = readFileSync(join(mcpacksEmptyDir, 'resourcepack.d.ts'), 'utf-8')
    expect(dtsContentEmpty).not.toContain('export function getResourcePack')
  });
});
