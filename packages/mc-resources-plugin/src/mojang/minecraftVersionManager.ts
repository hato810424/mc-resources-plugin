import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import StreamZip from 'node-stream-zip';
import defaultLogger from '../logger';

export interface VersionManifest {
  latest: {
    release: string;
    snapshot: string;
  };
  versions: Array<{
    id: string;
    type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
    url: string;
    time: string;
    releaseTime: string;
  }>;
}

export interface VersionDetails {
  id: string;
  downloads: {
    client: {
      sha1: string;
      size: number;
      url: string;
    };
    server: {
      sha1: string;
      size: number;
      url: string;
    };
  };
  assetIndex: {
    id: string;
    sha1: string;
    size: number;
    totalSize: number;
    url: string;
  };
}

export const MOJANG_PATHS = {
  manifest: 'https://launchermeta.mojang.com/mc/game/version_manifest.json',
  versionDetails: 'version_details',
  clientJars: 'version_details',
  langFiles: 'lang_files',
} as const;

const CACHE_EXPIRY_MS = 1000 * 60 * 60 * 24 * 30;

class MinecraftVersionManager {
  private cacheDir: string;
  private assetsFetchingTasks: Map<string, Promise<string>> = new Map();

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
    this.ensureCacheDir();
  }

  private ensureCacheDir() {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }

    const detailsDir = join(this.cacheDir, MOJANG_PATHS.versionDetails);
    if (!existsSync(detailsDir)) {
      mkdirSync(detailsDir, { recursive: true });
    }

    const clientJarsDir = join(this.cacheDir, MOJANG_PATHS.clientJars);
    if (!existsSync(clientJarsDir)) {
      mkdirSync(clientJarsDir, { recursive: true });
    }
  }

  private getManifestCachePath(): string {
    return join(this.cacheDir, 'version_manifest.json');
  }

  private isCacheExpired(filePath: string): boolean {
    try {
      const stats = require('fs').statSync(filePath);
      const age = Date.now() - stats.mtimeMs;
      return age > CACHE_EXPIRY_MS;
    } catch {
      return true;
    }
  }

  async getVersionManifest(forceRefresh = false): Promise<VersionManifest> {
    const cachePath = this.getManifestCachePath();

    // キャッシュから取得
    if (!forceRefresh && existsSync(cachePath) && !this.isCacheExpired(cachePath)) {
      try {
        const cachedData = readFileSync(cachePath, 'utf-8');
        return JSON.parse(cachedData) as VersionManifest;
      } catch (error) {
        defaultLogger.warn(`Failed to read version manifest cache: ${error}`);
      }
    }

    // APIから取得
    try {
      defaultLogger.info('Fetching version manifest from Mojang...');
      const response = await fetch(MOJANG_PATHS.manifest);

      if (!response.ok) {
        throw new Error(`Failed to fetch manifest: ${response.statusText}`);
      }

      const manifest = await response.json() as VersionManifest;

      // キャッシュに保存
      writeFileSync(cachePath, JSON.stringify(manifest, null, 2));
      defaultLogger.info('Version manifest cached successfully');

      return manifest;
    } catch (error) {
      defaultLogger.error(`Failed to fetch version manifest: ${error}`);
      
      // フォールバック：古いキャッシュを使用
      if (existsSync(cachePath)) {
        try {
          const cachedData = readFileSync(cachePath, 'utf-8');
          defaultLogger.warn('Using stale cache due to fetch failure');
          return JSON.parse(cachedData);
        } catch {
          throw new Error('Failed to fetch manifest and no valid cache available');
        }
      }

      throw error;
    }
  }

  async getVersionDetails(versionId: string, forceRefresh = false): Promise<VersionDetails> {
    // マニフェストから詳細情報のURLを取得
    const manifest = await this.getVersionManifest();

    if (versionId === 'latest') {
      versionId = manifest.latest.release;
    }
    const versionInfo = manifest.versions.find((v) => v.id === versionId);

    if (!versionInfo) {
      throw new Error(`Version ${versionId} not found in manifest`);
    }

    const cachePath = join(this.cacheDir, MOJANG_PATHS.versionDetails, `${versionId}.json`);

    // キャッシュから取得
    if (!forceRefresh && existsSync(cachePath) && !this.isCacheExpired(cachePath)) {
      try {
        const cachedData = readFileSync(cachePath, 'utf-8');
        return JSON.parse(cachedData);
      } catch (error) {
        defaultLogger.warn(`Failed to read version details cache: ${error}`);
      }
    }

    // 詳細情報をAPIから取得
    try {
      defaultLogger.info(`Fetching details for version ${versionId}...`);
      const response = await fetch(versionInfo.url);

      if (!response.ok) {
        throw new Error(`Failed to fetch version details: ${response.statusText}`);
      }

      const details = await response.json() as VersionDetails;

      // キャッシュに保存
      writeFileSync(cachePath, JSON.stringify(details, null, 2));
      defaultLogger.info(`Version details for ${versionId} cached successfully`);

      return details;
    } catch (error) {
      defaultLogger.error(`Failed to fetch version details for ${versionId}: ${error}`);
      
      // フォールバック：古いキャッシュを使用
      if (existsSync(cachePath)) {
        try {
          const cachedData = readFileSync(cachePath, 'utf-8');
          defaultLogger.warn(`Using stale cache for ${versionId} due to fetch failure`);
          return JSON.parse(cachedData);
        } catch {
          throw new Error(`Failed to fetch version details and no valid cache available for ${versionId}`);
        }
      }

      throw error;
    }
  }

  async getClientJar(versionId: string, forceRefresh = false): Promise<string> {
    const versionDetails = await this.getVersionDetails(versionId);
    const clientJarPath = join(this.cacheDir, MOJANG_PATHS.clientJars, `${versionDetails.id}.jar`);

    // キャッシュから取得
    if (!forceRefresh && existsSync(clientJarPath) && !this.isCacheExpired(clientJarPath)) {
      return clientJarPath;
    }

    // ダウンロード
    try {
      defaultLogger.info(`Downloading client jar for version ${versionDetails.id}...`);
      const clientJarUrl = versionDetails.downloads.client.url;
      const response = await fetch(clientJarUrl);

      if (!response.ok) {
        throw new Error(`Failed to download client jar: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      writeFileSync(clientJarPath, Buffer.from(arrayBuffer));
      defaultLogger.info(`Client jar for version ${versionDetails.id} cached successfully`);

      return clientJarPath;
    } catch (error) {
      defaultLogger.error(`Failed to download client jar for ${versionDetails.id}: ${error}`);
      
      // フォールバック：古いキャッシュを使用
      if (existsSync(clientJarPath)) {
        defaultLogger.warn(`Using stale cache for ${versionDetails.id} due to download failure`);
        return clientJarPath;
      }

      throw error;
    }
  }

  async getAssets(versionId: string, forceRefresh = false): Promise<string> {
    // 既に実行中のタスクがあれば、そのPromiseを返す
    const taskKey = `${versionId}:${forceRefresh}`;
    if (this.assetsFetchingTasks.has(taskKey)) {
      return this.assetsFetchingTasks.get(taskKey)!;
    }

    const assetsPromise = (async () => {
      const versionDetails = await this.getVersionDetails(versionId);
      const assetsDirPath = join(this.cacheDir, MOJANG_PATHS.versionDetails, versionDetails.id);

      // キャッシュから取得
      if (!forceRefresh && existsSync(assetsDirPath) && !this.isCacheExpired(assetsDirPath)) {
        return assetsDirPath;
      }

      try {
        // Jarをダウンロード
        const jarPath = await this.getClientJar(versionId, forceRefresh);
        const zip = new StreamZip.async({ file: jarPath });

        // 既存の展開ディレクトリを削除
        if (existsSync(assetsDirPath)) {
          rmSync(assetsDirPath, { recursive: true });
        }
        mkdirSync(assetsDirPath, { recursive: true });

        // Jarを解凍
        defaultLogger.info(`Extracting assets for version ${versionDetails.id}...`);
        
        const entries = await zip.entries();
        for (const entry of Object.values(entries)) {
          // 特定のディレクトリ配下のファイルのみを対象にする
          if (entry.name.startsWith("assets/minecraft")) {
            const destPath = join(assetsDirPath, entry.name);

            if (entry.isDirectory) {
              mkdirSync(destPath, { recursive: true });
            } else {
              // 親ディレクトリの作成を確実に行う
              mkdirSync(dirname(destPath), { recursive: true });
              // 解凍実行
              await zip.extract(entry.name, destPath);
            }
          }
        }

        await zip.close();
        defaultLogger.info(`Assets for version ${versionDetails.id} extracted successfully`);

        return assetsDirPath;
      } catch (error) {
        defaultLogger.error(`Failed to extract assets for ${versionDetails.id}: ${error}`);
        
        // フォールバック：古い展開ディレクトリを使用
        if (existsSync(assetsDirPath)) {
          defaultLogger.warn(`Using stale assets cache for ${versionDetails.id} due to extraction failure`);
          return assetsDirPath;
        }

        throw error;
      }
    })().finally(() => {
      this.assetsFetchingTasks.delete(taskKey);
    });

    this.assetsFetchingTasks.set(taskKey, assetsPromise);
    return assetsPromise;
  }

  async getLangFile(versionId: string, lang: string): Promise<string> {
    // en_us の場合はアセットから直接取得
    if (lang === 'en_us') {
      const assetsDirPath = await this.getAssets(versionId);
      return join(assetsDirPath, `assets/minecraft/lang/en_us.json`);
    }

    // 他言語の場合はAsset Indexからダウンロード
    const langFilePath = join(this.cacheDir, MOJANG_PATHS.langFiles, `${versionId}_${lang}.json`);

    // キャッシュから取得
    if (existsSync(langFilePath) && !this.isCacheExpired(langFilePath)) {
      return langFilePath;
    }

    try {
      defaultLogger.info(`Downloading language file: ${versionId}/${lang}`);

      // VersionDetails から assetIndex を取得
      const versionDetails = await this.getVersionDetails(versionId);
      const assetIndexUrl = versionDetails.assetIndex.url;

      // Asset Index をダウンロード
      const assetIndexResponse = await fetch(assetIndexUrl);
      if (!assetIndexResponse.ok) {
        throw new Error(`Failed to fetch asset index: ${assetIndexResponse.statusText}`);
      }

      const assetIndex = (await assetIndexResponse.json()) as {
        objects: Record<string, { hash: string; size: number }>;
      };

      // 言語ファイルのハッシュを取得
      const langKey = `minecraft/lang/${lang}.json`;
      const langObject = assetIndex.objects[langKey];

      if (!langObject) {
        throw new Error(`Language file not found in asset index: ${langKey}`);
      }

      const langHash = langObject.hash;
      const hashPrefix = langHash.substring(0, 2);
      const langFileUrl = `https://resources.download.minecraft.net/${hashPrefix}/${langHash}`;

      // 言語ファイルをダウンロード
      const langResponse = await fetch(langFileUrl);
      if (!langResponse.ok) {
        throw new Error(`Failed to download language file: ${langResponse.statusText}`);
      }

      // キャッシュディレクトリを作成
      const langDir = join(this.cacheDir, 'lang_files');
      if (!existsSync(langDir)) {
        mkdirSync(langDir, { recursive: true });
      }

      // ファイルを保存
      const langContent = await langResponse.text();
      writeFileSync(langFilePath, langContent);
      defaultLogger.info(`Language file cached: ${versionId}/${lang}`);

      return langFilePath;
    } catch (error) {
      defaultLogger.error(`Failed to download language file ${lang} for ${versionId}: ${error}`);
      throw error;
    }
  }

  async getLatestRelease(): Promise<string> {
    const manifest = await this.getVersionManifest();
    return manifest.latest.release;
  }

  async getLatestSnapshot(): Promise<string> {
    const manifest = await this.getVersionManifest();
    return manifest.latest.snapshot;
  }

  clearCache(): void {
    const cachePath = this.getManifestCachePath();
    if (existsSync(cachePath)) {
      require('fs').unlinkSync(cachePath);
      defaultLogger.info('Version manifest cache cleared');
    }
  }
}

export type { MinecraftVersionManager };
export function createVersionManager(cacheDir: string): MinecraftVersionManager {
  return new MinecraftVersionManager(cacheDir);
}
