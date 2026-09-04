import ReactDOM from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import App from './App';
import { ensureAgentBridgeListening } from './agent/rendererBridge';
import './styles/global.css';

// Electron + NODEFLOW_AGENT_BRIDGE 环境下挂载 Agent Bridge 监听(浏览器环境自动 no-op)
ensureAgentBridgeListening();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ReactFlowProvider>
    <App />
  </ReactFlowProvider>,
);
