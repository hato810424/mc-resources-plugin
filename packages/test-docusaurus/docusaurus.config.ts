import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import McResourcesDocusaurusPlugin from '@hato810424/mc-resources-plugin/docusaurus';
import path from 'path';

const config: Config = {
  title: 'MC Resources',
  tagline: 'Minecraft Resource Pack Documentation',
  favicon: 'img/favicon.ico',

  url: 'https://example.com',
  baseUrl: '/',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: false,
        blog: false,
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'MC Resources',
      items: [],
    },
    footer: {
      copyright: `© ${new Date().getFullYear()} MC Resources`,
    },
  } satisfies Preset.ThemeConfig,

  plugins: [
    McResourcesDocusaurusPlugin({
      resourcePackPath: path.resolve(__dirname, '../test/assets/resource-pack'),
      mcVersion: '1.18.2',
      outputPath: './src/mcpacks',
      startUpRenderCacheRefresh: true,
      logLevel: 'debug',
      include: ['**/*.mdx', '**/*.tsx', '**/*.ts', '**/*.js', '**/*.jsx'],
    }),
  ]
};

export default config;
