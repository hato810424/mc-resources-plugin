import findCacheDirectory from "find-cache-directory";

export const CONFIG = {
  OUTPUT_DIR: './mcpacks',
  EMPTY_OUT_DIR: false,
  INCLUDE: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
  EXCLUDE: [],
  CACHE_DIR: findCacheDirectory({
    name: '@hato810424/mc-resources-plugin',
    create: true,
  }),
  START_UP_RENDER_CACHE_REFRESH: false,
  TEXTURE_SIZE: 16,
  WIDTH: 128,
  HEIGHT: 128,
  ROTATION: [-30, 45, 0],
  LOG_LEVEL: 'info',
} as Readonly<{
  OUTPUT_DIR: string;
  EMPTY_OUT_DIR: boolean;
  INCLUDE: string[];
  EXCLUDE: string[];
  CACHE_DIR: string | undefined;
  START_UP_RENDER_CACHE_REFRESH: boolean;
  TEXTURE_SIZE: number;
  WIDTH: number;
  HEIGHT: number;
  ROTATION: [number, number, number];
  LOG_LEVEL: 'info' | 'debug' | 'error';
}>;
