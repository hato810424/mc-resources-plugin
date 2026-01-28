import * as z from 'zod';

export const PluginOptionsSchema = z.object({
  mcVersion: z.string().regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
    "有効なバージョン形式 (X.Y.Z) を入力してください"
  ),
  resourcePackPath: z.string(),
  outputPath: z.string().optional(),
  emptyOutDir: z.boolean().optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  cacheDir: z.string().optional(),
  startUpRenderCacheRefresh: z.boolean().optional(),
  logLevel: z.enum(['info', 'debug', 'error'] as const).optional(),
});

export type PluginOptions = z.infer<typeof PluginOptionsSchema>;

export interface ImageInfo {
  path: string;
  relativePath: string;
}
