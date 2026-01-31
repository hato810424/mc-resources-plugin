# @hato810424/mc-resources-plugin
MinecraftのリソースパックをWebで使用しやすくするVite, Webpack, Docusaurusプラグインです。

## インストール
[https://www.npmjs.com/package/@hato810424/mc-resources-plugin](https://www.npmjs.com/package/@hato810424/mc-resources-plugin)
```bash
pnpm install @hato810424/mc-resources-plugin
```

## 特徴
- Mojang APIを使用して、Minecraftのバージョンごとにモデルを取得し、レンダリングします。
- リソースパックのパスを指定するだけで、簡単にリソースパックを使用できます。

## 使い方
最低限の設定は以下の通りです。
```ts
import mcResourcesPlugin from '@hato810424/mc-resources-plugin/vite';

export default defineConfig({
  plugins: [
    mcResourcesPlugin({
      resourcePackPath: './assets/resource-pack',
      mcVersion: '1.18.2',
    })
  ],
});
```

プラグインを起動すると、ファイルが自動生成されるので、そのファイルをimportして使用します。
```tsx
import { getResourcePack } from 'path/to/mcpacks/resourcepack.mjs';

<img
  src={getResourcePack("minecraft:cake")} 
  style={{
    imageRendering: 'pixelated'
    // これを指定することで、テクスチャが綺麗に表示されます。
  }}
/>
```

## トラブルシューティング
- リソースパックを変更してもテクスチャが更新されない場合は、`cacheDir`で指定した場所のキャッシュを削除してください。

## Example
`./packages/test` にReact + Viteのプロジェクトがあります。プロジェクトルートで以下のコマンドを実行すると、ブラウザで表示されます。
```bash
pnpm install
pnpm run build
pnpm run dev:vite
```

## オプション
### resourcePackPath (required)
リソースパックのパスを指定します。

展開したリソースパックのパスを指定します。
```
指定したパス/
└── assets/
    └── minecraft/

minecraft/ 以下の画像ファイルが自動で検出され、出力されます。
```

### mcVersion (required)
Minecraftのバージョンを指定します。<br/>
Snapshotは指定できません。

### outputPath (default: './mcpacks')
出力パスを指定します。<br/>
自動更新されるため、Git等には含めないでください。

### emptyOutDir (default: false)
リソースパックの出力ディレクトリを自動生成時に空にするかどうかを指定します。

### include (default: `['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx']`)
リソースパックの自動生成時に対象とするファイルのパターンを指定します。

### exclude (default: `[]`)
リソースパックの自動生成時に除外するファイルのパターンを指定します。

always exclude: `['node_modules', '.git', '*.d.ts']`

### cacheDir (default: `node_modules/.cache/@hato810424/mc-resources-plugin`)
キャッシュディレクトリを指定します。

### startUpRenderCacheRefresh (default: false)
起動時にレンダーキャッシュを更新するかどうかを指定します。

### logLevel (default: 'info')
ログレベルを指定します。

- debug: デバッグログ（詳しい）
- info: デフォルトのログレベル（ふつう）
- error: エラーログのみ表示
