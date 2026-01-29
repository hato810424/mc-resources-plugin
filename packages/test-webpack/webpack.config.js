const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const McResourcesWebpackPlugin = require('@hato810424/mc-resources-plugin/webpack');

module.exports = {
  entry: './src/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
    clean: true,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html',
    }),
    new McResourcesWebpackPlugin({
      resourcePackPath: path.resolve(__dirname, '../test/assets/resource-pack'),
      mcVersion: '1.18.2',
      outputPath: './src/mcpacks',
      startUpRenderCacheRefresh: true,
      logLevel: 'debug',
    }),
  ],
  devServer: {
    static: {
      directory: path.join(__dirname, 'dist'),
    },
    compress: true,
    port: 3000,
  },
};
