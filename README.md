# @hato810424/mc-resources-plugin
MinecraftのリソースパックをWebで使用しやすくするViteプラグインです。

## 使い方
最低限の設定は以下の通りです。
```ts
import mcResourcesPlugin from '@hato810424/mc-resources-plugin/vite';

export default defineConfig({
  plugins: [
    mcResourcesPlugin({
      resourcePackPath: './assets/resource-pack'
    })
  ],
});
```

## Example
`./packages/test` にReact + Viteのプロジェクトがあります。
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
