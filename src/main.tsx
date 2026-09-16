import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { clearStaleChunkReloadGuard, installStaleChunkReload } from './lib/staleChunkReload';

// Precisa ser instalado antes de qualquer import() sob demanda acontecer —
// por isso entra logo no topo, antes até da renderização do React.
installStaleChunkReload();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Espera a página carregar por completo (mais uma folga) antes de liberar a
// guarda de recarregamento único. Ver src/lib/staleChunkReload.ts.
window.addEventListener('load', () => {
  window.setTimeout(clearStaleChunkReloadGuard, 2000);
});
