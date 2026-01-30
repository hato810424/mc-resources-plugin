// This file is based on the code from https://github.com/TABmk/minecraft-blocks-render
// The original code is licensed under the MIT License.
//
// Original work Copyright (c) 2020 TAB_mk
// Modified work Copyright (c) 2026 hato810424
//
// Licensed under the MIT License.
// https://opensource.org/licenses/MIT
//
import { createCanvas, loadImage, Canvas, CanvasRenderingContext2D } from 'canvas';
import { readFile, readdir, mkdir } from 'fs/promises';
import { dirname } from 'path';
import sharp from 'sharp';
import { MinecraftPathResolver } from './paths';
import { CONFIG } from '../env';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Face {
  texture: string;
  uv?: [number, number, number, number];
  cullface?: string;
  rotation?: number;
  tintindex?: number;
}

/**
 * Minecraft のティントカラーマップ（ブロック別）
 * tintindex に対応するRGB値を定義
 */
const TINT_COLORS: Record<string, Record<number, [number, number, number]>> = {
  // 草ブロック系: tintindex 0 = 緑色ティント
  grass_block: { 0: [127, 178, 56] }, // #7FB238
  grass: { 0: [127, 178, 56] },
  tall_grass: { 0: [127, 178, 56] },
  seagrass: { 0: [127, 178, 56] },
  
  // ツタ系: tintindex 0 = 緑色ティント
  vine: { 0: [127, 178, 56] },
  
  // 葉系: tintindex 0 = 緑色ティント
  oak_leaves: { 0: [127, 178, 56] },
  birch_leaves: { 0: [128, 168, 63] },
  spruce_leaves: { 0: [95, 130, 60] },
  jungle_leaves: { 0: [97, 163, 43] },
  acacia_leaves: { 0: [155, 178, 33] },
  dark_oak_leaves: { 0: [103, 117, 53] },
  
  // 茶色系
  cocoa: { 0: [128, 92, 63] },
  
  // サボテン
  cactus: { 0: [95, 160, 54] },
  
  // 水系
  water: { 0: [63, 127, 255] },
  water_cauldron: { 0: [63, 127, 255] },
};

interface Element {
  from: [number, number, number];
  to: [number, number, number];
  rotation?: {
    origin: [number, number, number];
    axis: 'x' | 'y' | 'z';
    angle: number;
    rescale?: boolean;
  };
  shade?: boolean;
  faces: {
    down?: Face;
    up?: Face;
    north?: Face;
    south?: Face;
    west?: Face;
    east?: Face;
  };
}

interface MinecraftModel {
  parent?: string;
  textures?: Record<string, string>;
  elements?: Element[];
  display?: {
    gui?: {
      rotation?: [number, number, number];
      translation?: [number, number, number];
      scale?: [number, number, number];
    };
    thirdperson_righthand?: {
      rotation?: [number, number, number];
      translation?: [number, number, number];
      scale?: [number, number, number];
    };
  };
}

interface RenderOptions {
  width: number;
  height: number;
  scale?: number;
  rotation?: [number, number, number]; // x, y, z rotation in degrees
}

export class MinecraftBlockRenderer {
  private modelsCache = new Map<string, MinecraftModel>();
  private texturesCache = new Map<string, Canvas>();
  private resourcePackPathResolver: MinecraftPathResolver;
  private modelPathResolver: MinecraftPathResolver;

  constructor(resourcePackPath: string, modelPath?: string) {
    this.resourcePackPathResolver = new MinecraftPathResolver(resourcePackPath);
    this.modelPathResolver = new MinecraftPathResolver(modelPath ?? resourcePackPath);
  }

  /**
   * ブロック名からモデルパスを解決
   */
  private async resolveBlockModelPath(blockName: string): Promise<string> {
    // block/{blockName} のパスを返す
    const modelPath = `block/${blockName.replace(/^minecraft:/, '')}`;
    console.debug(`[BlockModel] ${blockName} -> ${modelPath}`);
    return modelPath;
  }

  /**
   * モデルファイルを読み込んで、parent継承を解決する
   */
  private async loadModel(modelPath: string): Promise<MinecraftModel> {
    const fullPath = this.modelPathResolver.getModelFilePath(modelPath);

    if (this.modelsCache.has(fullPath)) {
      return this.modelsCache.get(fullPath)!;
    }

    const content = await readFile(fullPath, 'utf-8');
    const model: MinecraftModel = JSON.parse(content);

    // parent継承の解決
    if (model.parent) {
      const parentModel = await this.loadModel(model.parent);
      const merged: MinecraftModel = {
        ...parentModel,
        ...model,
        textures: {
          ...parentModel.textures,
          ...model.textures,
        },
        elements: model.elements || parentModel.elements,
      };
      this.modelsCache.set(fullPath, merged);
      return merged;
    }

    this.modelsCache.set(fullPath, model);
    return model;
  }

  /**
   * テクスチャ参照を解決（#texture_nameのような参照を実際のパスに変換）
   */
  private resolveTexture(texture: string, textures: Record<string, string>, visited = new Set<string>()): string {
    if (texture.startsWith('#')) {
      const key = texture.slice(1);
      if (visited.has(key)) return texture; // 循環参照を避ける
      visited.add(key);
      if (textures[key]) {
        return this.resolveTexture(textures[key], textures, visited);
      }
    }
    // パスを正規化（textures/プレフィックスは除去）
    let texturePath = this.resourcePackPathResolver.normalizeTexturePath(texture);
    texturePath = texturePath.replace(/^textures\//, '');
    return texturePath;
  }

  /**
   * テクスチャ画像を読み込む（上下面は水平反転、壁面は反転なし）
   */
  private async loadTexture(texturePath: string, faceName?: 'down' | 'up' | 'north' | 'south' | 'west' | 'east'): Promise<Canvas> {
    const shouldFlipX = faceName === 'up' || faceName === 'down';
    const cacheKey = shouldFlipX ? `${texturePath}:flipX` : texturePath;
    
    if (this.texturesCache.has(cacheKey)) {
      return this.texturesCache.get(cacheKey)!;
    }

    const fullPath = this.resourcePackPathResolver.getTextureFilePath(texturePath);

    try {
      const image = await loadImage(fullPath);
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d');
      
      // 上下面のみ水平反転
      if (shouldFlipX) {
        ctx.scale(-1, 1);
        ctx.drawImage(image, -image.width, 0);
      } else {
        ctx.drawImage(image, 0, 0);
      }
      
      this.texturesCache.set(cacheKey, canvas);
      return canvas;
    } catch (error) {
      console.warn(`Failed to load texture: ${fullPath}`);
      // テクスチャが見つからない場合は紫黒のチェッカーボードを返す
      const canvas = createCanvas(16, 16);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f800f8';
      ctx.fillRect(0, 0, 16, 16);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 8, 8);
      ctx.fillRect(8, 8, 8, 8);
      return canvas;
    }
  }

  /**
   * 3D座標を2D画面座標に投影（アイソメトリック風）
   */
  private project(
    point: Vec3,
    rotation: [number, number, number],
    scale: number
  ): { x: number; y: number; z: number } {
    const [rotX, rotY, rotZ] = rotation.map((deg) => (deg * Math.PI) / 180);

    // 回転行列の適用
    let { x, y, z } = point;

    // Y軸回転
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const x1 = x * cosY - z * sinY;
    const z1 = x * sinY + z * cosY;

    // X軸回転
    const cosX = Math.cos(rotX);
    const sinX = Math.sin(rotX);
    const y1 = y * cosX - z1 * sinX;
    const z2 = y * sinX + z1 * cosX;

    // Z軸回転
    const cosZ = Math.cos(rotZ);
    const sinZ = Math.sin(rotZ);
    const x2 = x1 * cosZ - y1 * sinZ;
    const y2 = x1 * sinZ + y1 * cosZ;

    return {
      x: x2 * scale,
      y: y2 * scale,
      z: z2, // 深度情報を保持
    };
  }

  /**
   * テクスチャ付きの四角形を描画する（4頂点パス）
   * @param ctx Canvas 2D コンテキスト
   * @param centerX キャンバス中心X
   * @param centerY キャンバス中心Y
   * @param texture ロード済みのImageオブジェクト
   * @param vertices 投影済みの2D頂点 4個 (z含む)
   * @param uvCoords UV座標 4個 (0-16)
   * @param passes テクスチャ貼り付けのパス数（1 or 2）
   */
  private drawTexturedQuad(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    texture: any,
    vertices: Array<{x: number, y: number}>,
    uvCoords: Array<{u: number, v: number}>,
    passes: number = 1
  ) {
    if (vertices.length !== 4 || uvCoords.length !== 4) return;

    ctx.save();

    // --- 1. 隙間対策：四角形をわずかに膨らませる ---
    const offset = 0.3;
    const quadCenterX = vertices.reduce((sum, p) => sum + p.x, 0) / 4;
    const quadCenterY = vertices.reduce((sum, p) => sum + p.y, 0) / 4;

    const expand = (p: {x: number, y: number}) => {
      const dx = p.x - quadCenterX;
      const dy = p.y - quadCenterY;
      const mag = Math.sqrt(dx * dx + dy * dy);
      return {
        x: p.x + (dx / mag) * offset,
        y: p.y + (dy / mag) * offset * 3,
      };
    };

    const expandedVertices = vertices.map(expand);

    // --- 2. 4頂点パスの作成 ---
    ctx.beginPath();
    ctx.moveTo(centerX + expandedVertices[0].x, centerY - expandedVertices[0].y);
    ctx.lineTo(centerX + expandedVertices[1].x, centerY - expandedVertices[1].y);
    ctx.lineTo(centerX + expandedVertices[2].x, centerY - expandedVertices[2].y);
    ctx.lineTo(centerX + expandedVertices[3].x, centerY - expandedVertices[3].y);
    ctx.closePath();
    ctx.clip();

    // --- 3. 行列変換を使用してテクスチャを描画 ---
    // パス1: 3点（v0,v1,v2）でアフィン変換行列を計算
    const p0 = vertices[0], p1 = vertices[1], p2 = vertices[2];
    const u0 = uvCoords[0].u, v0 = uvCoords[0].v;
    const u1 = uvCoords[1].u, v1 = uvCoords[1].v;
    const u2 = uvCoords[2].u, v2 = uvCoords[2].v;

    const delta = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    
    if (Math.abs(delta) > 0.0001) {
      const m11 = ((p1.x - p0.x) * (v2 - v0) - (p2.x - p0.x) * (v1 - v0)) / delta;
      const m12 = -((p1.y - p0.y) * (v2 - v0) - (p2.y - p0.y) * (v1 - v0)) / delta;
      const m21 = ((p2.x - p0.x) * (u1 - u0) - (p1.x - p0.x) * (u2 - u0)) / delta;
      const m22 = -((p2.y - p0.y) * (u1 - u0) - (p1.y - p0.y) * (u2 - u0)) / delta;
      
      const dx = centerX + p0.x - (m11 * u0 + m21 * v0);
      const dy = centerY - p0.y - (m12 * u0 + m22 * v0);

      ctx.setTransform(m11, m12, m21, m22, dx, dy);
      ctx.drawImage(texture, 0, 0);

      // パス2: 3点（v0,v2,v3）でアフィン変換行列を計算（passes=2の場合）
      if (passes === 2) {
        const p3 = vertices[3];
        const u3 = uvCoords[3].u, v3 = uvCoords[3].v;
        
        const delta2 = (u2 - u0) * (v3 - v0) - (u3 - u0) * (v2 - v0);
        
        if (Math.abs(delta2) > 0.0001) {
          const m11_2 = ((p2.x - p0.x) * (v3 - v0) - (p3.x - p0.x) * (v2 - v0)) / delta2;
          const m12_2 = -((p2.y - p0.y) * (v3 - v0) - (p3.y - p0.y) * (v2 - v0)) / delta2;
          const m21_2 = ((p3.x - p0.x) * (u2 - u0) - (p2.x - p0.x) * (u3 - u0)) / delta2;
          const m22_2 = -((p3.y - p0.y) * (u2 - u0) - (p2.y - p0.y) * (u3 - u0)) / delta2;
          
          const dx2 = centerX + p0.x - (m11_2 * u0 + m21_2 * v0);
          const dy2 = centerY - p0.y - (m12_2 * u0 + m22_2 * v0);

          ctx.setTransform(m11_2, m12_2, m21_2, m22_2, dx2, dy2);
          ctx.drawImage(texture, 0, 0);
        }
      }
    }

    ctx.restore();
  }

  /**
   * テクスチャにティント色を適用（透明部分は保護）
   */
  private applyTint(texture: Canvas, tintColor: [number, number, number]): Canvas {
    const [r, g, b] = tintColor;
    const width = texture.width;
    const height = texture.height;
    
    // ティント済みテクスチャ用キャンバスを作成
    const tintedCanvas = createCanvas(width, height);
    const tintCtx = tintedCanvas.getContext('2d');
    
    // 元のテクスチャを描画
    tintCtx.drawImage(texture, 0, 0);
    
    // 元のテクスチャのピクセルデータを取得
    const sourceImageData = tintCtx.getImageData(0, 0, width, height);
    const sourceData = sourceImageData.data;
    
    // ティント済みレイヤーをオフスクリーンキャンバスに描画
    const tintLayerCanvas = createCanvas(width, height);
    const tintLayerCtx = tintLayerCanvas.getContext('2d');
    tintLayerCtx.globalCompositeOperation = 'multiply';
    tintLayerCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    tintLayerCtx.fillRect(0, 0, width, height);
    
    // ティント済みレイヤーを適用
    tintCtx.globalCompositeOperation = 'multiply';
    tintCtx.drawImage(tintLayerCanvas, 0, 0);
    
    // 結果のピクセルデータを取得
    const resultImageData = tintCtx.getImageData(0, 0, width, height);
    const resultData = resultImageData.data;
    
    // 元のアルファ値が0だったピクセルは透明のまま保つ
    for (let i = 0; i < sourceData.length; i += 4) {
      const originalAlpha = sourceData[i + 3];
      if (originalAlpha === 0) {
        // 完全透明なピクセルは透明のまま
        resultData[i] = 0;
        resultData[i + 1] = 0;
        resultData[i + 2] = 0;
        resultData[i + 3] = 0;
      } else {
        // 元のアルファ値を保持
        resultData[i + 3] = originalAlpha;
      }
    }
    
    // 修正後のデータをキャンバスに戻す
    tintCtx.putImageData(resultImageData, 0, 0);
    
    return tintedCanvas;
  }

  /**
   * モデル名からティントカラーを取得
   * 未知のブロックの場合はデフォルト緑色を返す
   */
  private getTintColor(modelPath: string, tintindex?: number): [number, number, number] | null {
    if (tintindex === undefined) return null;
    
    const nameParts = modelPath.split('/');
    const type = nameParts[0]; // 'block' or 'item'
    const baseName = nameParts.pop()?.replace(/\.json$/, '');
    if (!baseName) return null;

    const colorMap = TINT_COLORS[baseName];
    if (!colorMap) {
      console.debug(`[Tint] Unknown ${type} "${baseName}" with tintindex ${tintindex}, using default green tint`);
      return [127, 178, 56]; // デフォルト緑色 #7FB238
    }
    
    return colorMap[tintindex] || null;
  }

  /**
   * ブロックモデルをレンダリング
   */
  async renderBlock(
    modelPath: string,
    outputPath: string,
    options: RenderOptions,
  ): Promise<void> {
    const {
      width,
      height,
      rotation = CONFIG.ROTATION,
    } = options;

    // scaleが未指定の場合、height, widthどちらか小さい方のサイズに基づいて動的に計算
    const scale = options.scale ?? Math.round((height > width ? width : height) / 25.6);

    // blockstate から実際のモデルパスを解決
    // modelPath が block/{name} 形式の場合は、blockstate をチェック
    let resolvedModelPath = modelPath;
    if (modelPath.startsWith('block/')) {
      const blockName = modelPath.replace(/^block\//, '');
      const resolvedPath = await this.resolveBlockModelPath(blockName);
      // resolvedPath が minecraft: プレフィックスを持つ場合のみ使用
      if (resolvedPath && resolvedPath !== `block/${blockName}`) {
        resolvedModelPath = resolvedPath;
      }
    }

    // モデルパスを正規化（minecraft: プレフィックス等を除去）
    const normalizedModelPath = this.modelPathResolver.normalizeModelPath(resolvedModelPath);
    console.debug(`[Render] Final model path: ${resolvedModelPath} -> ${normalizedModelPath}`);

    const model = await this.loadModel(normalizedModelPath);
    if (!model.elements) throw new Error('Model has no elements to render');
  
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
  
    const centerX = width / 2;
    const centerY = height / 2;
  
    // === A. 全パーツの全フェイスを格納するバッファ ===
    const allFacesToRender: any[] = [];

    for (const element of model.elements) {
      const faceNames: Array<'down' | 'up' | 'north' | 'south' | 'west' | 'east'> = 
        ['down', 'up', 'north', 'south', 'west', 'east'];

      for (const faceName of faceNames) {
        const face = element.faces[faceName];
        if (!face) continue;

        const from = element.from.map((v) => v - 8) as [number, number, number];
        const to = element.to.map((v) => v - 8) as [number, number, number];
        let vertices: Vec3[] = [];

        // 頂点定義（既存のものを維持）
        switch (faceName) {
          case 'up': vertices = [{x:from[0],y:to[1],z:to[2]},{x:to[0],y:to[1],z:to[2]},{x:to[0],y:to[1],z:from[2]},{x:from[0],y:to[1],z:from[2]}]; break;
          case 'down': vertices = [{x:from[0],y:from[1],z:from[2]},{x:to[0],y:from[1],z:from[2]},{x:to[0],y:from[1],z:to[2]},{x:from[0],y:from[1],z:to[2]}]; break;
          case 'north': vertices = [{x:to[0],y:from[1],z:from[2]},{x:from[0],y:from[1],z:from[2]},{x:from[0],y:to[1],z:from[2]},{x:to[0],y:to[1],z:from[2]}]; break;
          case 'south': vertices = [{x:from[0],y:from[1],z:to[2]},{x:to[0],y:from[1],z:to[2]},{x:to[0],y:to[1],z:to[2]},{x:from[0],y:to[1],z:to[2]}]; break;
          case 'west': vertices = [{x:from[0],y:from[1],z:from[2]},{x:from[0],y:from[1],z:to[2]},{x:from[0],y:to[1],z:to[2]},{x:from[0],y:to[1],z:from[2]}]; break;
          case 'east': vertices = [{x:to[0],y:from[1],z:to[2]},{x:to[0],y:from[1],z:from[2]},{x:to[0],y:to[1],z:from[2]},{x:to[0],y:to[1],z:to[2]}]; break;
        }

        const projected = vertices.map((v) => this.project(v, rotation, scale));

        // 背面カリング: 投影後の2D外積で判定
        const v0 = projected[0], v1 = projected[1], v2 = projected[2];
        const determinant = (v1.x - v0.x) * (v2.y - v0.y) - (v1.y - v0.y) * (v2.x - v0.x);
        if (determinant >= 0) continue; 

        // 深度計算: 平均Zと最小Zを組み合わせてソートの精度を上げる
        const avgZ = projected.reduce((sum, p) => sum + p.z, 0) / 4;
        const minZ = Math.min(...projected.map(p => p.z));

        allFacesToRender.push({ faceName, face, projected, avgZ, minZ });
      }
    }
  
    // === B. 深度ソートの修正 ===
    // キャンバスは「後から描いたものが上に重なる」ため、
    // 遠いもの（Zが小さい）を先に、近いもの（Zが大きい）を後に描画します。
    allFacesToRender.sort((a, b) => b.avgZ - a.avgZ);
  
    // === C. 描画ループ内の法線重ね塗りの修正 ===
    for (const renderData of allFacesToRender) {
      const { faceName, face, projected } = renderData;
      const texturePath = this.resolveTexture(face.texture, model.textures || {});
      let texture = await this.loadTexture(texturePath, faceName);

      // ティント色を適用（tintindexがあれば適用、透明部分は保護）
      if (face.tintindex !== undefined) {
        const tintColor = this.getTintColor(normalizedModelPath, face.tintindex);
        if (tintColor) {
          console.debug(`[Tint] ${faceName} face of ${normalizedModelPath}: applying tint ${tintColor} (tintindex: ${face.tintindex})`);
          texture = this.applyTint(texture, tintColor);
        }
      } else {
        console.debug(`[Tint] ${faceName} face of ${normalizedModelPath}: no tint (texturePath: ${texturePath})`);
      }

      // 描画状態を完全に分離
      ctx.save();
      
      // 1. テクスチャ描画
      const uv = face.uv || [0, 0, 16, 16];
      const uMin = uv[0], vMin = uv[1];
      const uMax = uv[2], vMax = uv[3];
      
      // 面の方角によって、頂点とUVの対応を切り替える
      let uvCoords: {u: number, v: number}[] = [];
      
      // UV回転を適用するヘルパー関数
      const rotateUVCoords = (coords: {u: number, v: number}[], rotation: number) => {
        const rot = ((rotation || 0) % 360 + 360) % 360;
        const steps = rot / 90;
        let result = [...coords];
        for (let i = 0; i < steps; i++) {
          // 時計回りに90度回転
          result = [result[3], result[0], result[1], result[2]];
        }
        return result;
      };

      switch (faceName) {
        case 'up':
        case 'down':
          // 水平方向の面
          uvCoords = [
            { u: uMin, v: vMax }, // 頂点0
            { u: uMax, v: vMax }, // 頂点1
            { u: uMax, v: vMin }, // 頂点2
            { u: uMin, v: vMin }  // 頂点3
          ];
          break;
        default:
          // 垂直方向の面 (north, south, east, west)
          // 側面が引き伸ばされる場合、ここを調整します
          uvCoords = [
            { u: uMax, v: vMax }, // 頂点0 (右下)
            { u: uMin, v: vMax }, // 頂点1 (左下)
            { u: uMin, v: vMin }, // 頂点2 (左上)
            { u: uMax, v: vMin }  // 頂点3 (右上)
          ];
          break;
      }
      
      // UV回転を適用
      uvCoords = rotateUVCoords(uvCoords, face.rotation);

      // 4頂点パスでテクスチャを描画（2パスで対応）
      this.drawTexturedQuad(
        ctx, centerX, centerY, texture,
        [
          {x: projected[0].x, y: projected[0].y},
          {x: projected[1].x, y: projected[1].y},
          {x: projected[2].x, y: projected[2].y},
          {x: projected[3].x, y: projected[3].y}
        ],
        uvCoords,
        2 // 2パスでテクスチャを貼る
      );

      // 2. 法線オーバーレイ
      // ここで大事なのは、1つの面（Face）ごとに「テクスチャ+法線」をセットで描き切ることです
      // 座標系をリセットして法線を塗る
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      ctx.moveTo(centerX + projected[0].x, centerY - projected[0].y);
      ctx.lineTo(centerX + projected[1].x, centerY - projected[1].y);
      ctx.lineTo(centerX + projected[2].x, centerY - projected[2].y);
      ctx.lineTo(centerX + projected[3].x, centerY - projected[3].y);
      ctx.closePath();

      // 影と法線の色を合成
      let shade = 1.0;
      switch (faceName) {
        case 'up':    shade = 1.0;  break;
        case 'down':  shade = 0.5;  break;
        case 'north': 
        case 'south': shade = 0.4;  break;
        case 'west':  
        case 'east':  shade = 0.7;  break;
      }

      // shadeに応じて黒色 (0,0,0) の透明度を変える
      const shadowAlpha = 1.0 - shade;
      const shadowColor = `rgba(0, 0, 0, ${shadowAlpha})`;

      // 影を描写（テクスチャが存在する部分だけに適用）
      ctx.globalCompositeOperation = 'source-atop'; 
      ctx.fillStyle = shadowColor;
      ctx.fill();

      // 隙間埋めのストロークも影の色に合わせると綺麗
      ctx.strokeStyle = shadowColor;
      ctx.lineWidth = 0.4;
      ctx.lineJoin = 'round';
      ctx.stroke();
      
      // 法線デバッグ色を塗る（デバッグ時は以下をコメント解除）
      // const normalColor = (() => {
      //   switch (faceName) {
      //     case 'up': return 'rgba(0, 255, 0, 0.15)';
      //     case 'down': return 'rgba(255, 0, 255, 0.15)';
      //     case 'north': return 'rgba(0, 0, 255, 0.15)';
      //     case 'south': return 'rgba(255, 0, 0, 0.15)';
      //     case 'west': return 'rgba(255, 255, 0, 0.15)';
      //     case 'east': return 'rgba(0, 255, 255, 0.15)';
      //     default: return 'transparent';
      //   }
      // })();
      // ctx.fillStyle = normalColor;
      // ctx.fill();

      ctx.restore();
    }
  
    // 出力
    const buffer = canvas.toBuffer('image/png');
    await mkdir(dirname(outputPath), { recursive: true });
    await sharp(buffer).png().toFile(outputPath);
  }

  /**
   * modelsディレクトリ内のすべてのモデルをレンダリング
   */
  async renderAllModels(outputDir: string, options: RenderOptions): Promise<void> {
    const modelsDir = this.modelPathResolver.getBlockModelsDir();
    const files = await readdir(modelsDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const modelPath = file.replace('.json', '');
      const outputPath = dirname(outputDir) + '/' + modelPath.split('/').pop() + '.png';

      console.log(`Rendering ${file}...`);
      try {
        await this.renderBlock(modelPath, outputPath, options);
        console.log(`✓ Saved to ${outputPath}`);
      } catch (error) {
        console.error(`✗ Failed to render ${file}:`, error);
      }
    }
  }
}
