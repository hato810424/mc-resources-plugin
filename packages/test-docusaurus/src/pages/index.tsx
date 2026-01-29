import type {ReactNode} from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import { getResourcePack } from '../mcpacks/resourcepack';

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description={siteConfig.tagline}>
      <main>
        <div style={{padding: '2rem'}}>
          <h1>Docusaurus + @hato810424/mc-resources-plugin</h1>
          <p>Minecraft Resource Pack Example</p>
          <div>
            <img src={getResourcePack("minecraft:dispenser")} style={{ width: '100px', height: '100px', imageRendering: 'pixelated' }} />
            <img src={getResourcePack("minecraft:dispenser", { width: 32 })} style={{ width: '100px', height: '100px', imageRendering: 'pixelated' }} />
            <img src={getResourcePack("minecraft:golden_apple")} style={{ width: '100px', height: '100px', imageRendering: 'pixelated' }} />
            <img src={getResourcePack("minecraft:anvil")} style={{ width: '100px', height: '100px', imageRendering: 'pixelated' }} />
          </div>
        </div>
      </main>
    </Layout>
  );
}
