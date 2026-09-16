/**
 * Recuperação de "chunk" perdido após um novo deploy.
 *
 * Cada deploy da Vercel troca o nome de todo arquivo em /assets (o hash no
 * nome muda). Quem estava com o CRM aberto numa aba desde antes do deploy
 * continua rodando o JavaScript antigo — e esse JavaScript antigo tenta
 * `import()` sob demanda (xlsx, pdf-lib, pdfjs-dist, jszip, ffmpeg.wasm) um
 * arquivo que já não existe mais no servidor. O navegador aborta com
 * "Failed to fetch dynamically imported module" e a funcionalidade quebra
 * até a pessoa dar F5 por conta própria.
 *
 * Aqui a gente detecta esse erro específico e recarrega a página sozinha,
 * uma única vez por sessão de aba — o F5 que a pessoa daria manualmente.
 */

const RELOAD_GUARD_KEY = 'crm:stale-chunk-reload';

const STALE_CHUNK_PATTERN =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

function looksLikeStaleChunk(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason ?? '');
  return STALE_CHUNK_PATTERN.test(message);
}

function reloadOnce() {
  // Sem essa guarda, um problema de rede real (sem stale chunk nenhum)
  // recarregaria em loop infinito. Uma tentativa por navegação é o bastante:
  // se recarregar não resolver, o problema não é chunk desatualizado.
  if (sessionStorage.getItem(RELOAD_GUARD_KEY)) return;
  sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
  window.location.reload();
}

export function installStaleChunkReload() {
  // Evento nativo do Vite para falhas no preload de módulos.
  window.addEventListener('vite:preloadError', () => reloadOnce());

  // As chamadas `await import(...)` espalhadas pelo app (csv.ts, zplPdf.ts,
  // MetaAdCreator.jsx) rejeitam a Promise em vez de disparar esse evento.
  window.addEventListener('unhandledrejection', (event) => {
    if (looksLikeStaleChunk(event.reason)) reloadOnce();
  });
}

/**
 * Chamar depois que a aplicação já montou com sucesso. Sem isso, a guarda
 * ficaria travada pelo resto da sessão da aba: um segundo deploy publicado
 * enquanto a pessoa segue trabalhando não conseguiria disparar um novo
 * recarregamento automático.
 */
export function clearStaleChunkReloadGuard() {
  sessionStorage.removeItem(RELOAD_GUARD_KEY);
}
