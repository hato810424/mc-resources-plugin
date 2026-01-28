import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import { getResourcePack } from './mcpacks/resourcepack'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <img src={getResourcePack("minecraft:dispenser")} style={{ width: '100px', height: '100px', imageRendering: 'pixelated' }} />
      <img src={getResourcePack("minecraft:cake")} style={{ width: '100px', height: '100px', imageRendering: 'pixelated' }} />
      <img src={getResourcePack("minecraft:anvil")} style={{ width: '100px', height: '100px', imageRendering: 'pixelated' }} />
    </>
  )
}

export default App
