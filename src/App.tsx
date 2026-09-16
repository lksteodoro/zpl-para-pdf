import { ZplPdfPage } from './ZplPdfPage';

/**
 * Aplicação pública: não há login, conta ou servidor próprio.
 *
 * A conversão acontece no navegador de quem usa — o ZPL é enviado apenas ao
 * serviço de renderização da Labelary e o PDF é montado localmente. Nada é
 * gravado em lugar nenhum.
 */
export function App() {
  return (
    <div className="mx-auto min-h-full w-full max-w-6xl">
      <ZplPdfPage />
      <footer className="px-4 pb-8 text-center text-xs text-[var(--color-text-faint)] sm:px-6">
        A conversão roda no seu navegador. Nenhuma etiqueta é armazenada.
      </footer>
    </div>
  );
}
