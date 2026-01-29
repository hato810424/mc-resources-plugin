import React from 'react';
import { getResourcePack } from './mcpacks/resourcepack.mjs';

const App: React.FC = () => {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Hello, Webpack + React + TypeScript!</h1>
      <p>This is a simple template to get you started.</p>
      <img src={getResourcePack("minecraft:dispenser")} style={{ width: '100px', height: '100px', imageRendering: 'pixelated' }} />
      <img src={getResourcePack("minecraft:dispenser", { width: 32 })} style={{ width: '100px', height: '100px', imageRendering: 'pixelated' }} />
      <img src={getResourcePack("minecraft:golden_apple")} style={{ width: '100px', height: '100px', imageRendering: 'pixelated' }} />
      <img src={getResourcePack("minecraft:anvil")} style={{ width: '100px', height: '100px', imageRendering: 'pixelated' }} />
    </div>
  );
};

export default App;
