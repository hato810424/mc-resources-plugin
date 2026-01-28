import findCacheDirectory from "find-cache-directory";

export const CACHE_DIR = findCacheDirectory({
  name: '@hato810424/mc-resources-plugin',
  create: true,
});

