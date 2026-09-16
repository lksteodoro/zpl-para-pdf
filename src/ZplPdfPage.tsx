import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  FileCode2,
  FileOutput,
  LoaderCircle,
  Printer,
  Settings2,
  TriangleAlert,
  UploadCloud,
} from 'lucide-react';
import { Card } from './components/Card';
import {
  analyzeZpl,
  convertZplToPdf,
  countZplLabels,
  extractPrintableZplBlocks,
  MAX_ZPL_LABELS,
  type ZplConversionProgress,
  type ZplDensity,
  type ZplRotation,
} from './lib/zplPdf';

const exampleZpl = `^XA
^CF0,36
^FO40,40^FDExemplo de etiqueta^FS
^BY3,2,90
^FO40,100^BCN,90,Y,N,N^FD1234567890^FS
^XZ`;

export function ZplPdfPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const pdfPreviewRef = useRef<HTMLIFrameElement>(null);
  const [zpl, setZpl] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [sourceDensity, setSourceDensity] = useState<ZplDensity>(8);
  const [density, setDensity] = useState<ZplDensity>(12);
  const [width, setWidth] = useState('11');
  const [height, setHeight] = useState('15');
  const [rotation, setRotation] = useState<ZplRotation>(0);
  const [dragging, setDragging] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState<ZplConversionProgress | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const labelCount = useMemo(() => countZplLabels(zpl), [zpl]);
  const blockSummary = useMemo(() => {
    if (!zpl.trim()) return null;
    const blocks = analyzeZpl(zpl);
    if (blocks.length === 0) return null;
    return { blocks, duplicated: blocks.some((block) => block.copies > 1) };
  }, [zpl]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  function clearPreview() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPdfUrl(null);
  }

  async function readFile(file: File) {
    if (!/\.(zpl|txt|prn|zip)$/i.test(file.name)) {
      setError('Envie um arquivo ZIP, ZPL, TXT ou PRN.');
      return;
    }
    setReadingFile(true);
    setError(null);
    setZpl('');
    setFileName(null);
    clearPreview();
    try {
      if (/\.zip$/i.test(file.name)) {
        const { default: JSZip } = await import('jszip');
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const candidates = Object.values(zip.files)
          .filter((entry) => !entry.dir && /\.(txt|zpl|prn)$/i.test(entry.name))
          .sort((first, second) => first.name.localeCompare(second.name, 'pt-BR', { numeric: true }));

        const labels: string[] = [];
        const importedFiles: string[] = [];
        for (const entry of candidates) {
          const text = await entry.async('string');
          const blocks = extractPrintableZplBlocks(text);
          if (blocks.length > 0) {
            labels.push(...blocks);
            importedFiles.push(entry.name);
          }
        }

        if (labels.length === 0) {
          throw new Error('O ZIP não contém arquivos TXT, ZPL ou PRN com etiquetas válidas entre ^XA e ^XZ.');
        }
        const combinedZpl = labels.join('\n');
        const totalLabels = countZplLabels(combinedZpl);
        if (totalLabels > MAX_ZPL_LABELS) {
          throw new Error(`O ZIP contém ${totalLabels} etiquetas. O máximo por conversão é ${MAX_ZPL_LABELS}.`);
        }
        setZpl(combinedZpl);
        setFileName(`${file.name} · ${importedFiles.length} arquivo(s) com etiqueta`);
      } else {
        setZpl(await file.text());
        setFileName(file.name);
      }
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : 'Não foi possível abrir o arquivo.');
    } finally {
      setReadingFile(false);
    }
  }

  async function convert() {
    const widthCm = Number(width.replace(',', '.'));
    const heightCm = Number(height.replace(',', '.'));
    if (!zpl.trim()) return setError('Cole um código ZPL ou selecione um arquivo.');
    if (labelCount < 1) return setError('Nenhuma etiqueta válida foi encontrada entre ^XA e ^XZ.');
    if (labelCount > MAX_ZPL_LABELS) return setError(`O limite é de ${MAX_ZPL_LABELS} etiquetas por conversão.`);
    if (!Number.isFinite(widthCm) || widthCm <= 0 || widthCm > 38.1) return setError('Informe uma largura entre 0,1 e 38,1 centímetros.');
    if (!Number.isFinite(heightCm) || heightCm <= 0 || heightCm > 38.1) return setError('Informe uma altura entre 0,1 e 38,1 centímetros.');

    setConverting(true);
    setProgress(null);
    setError(null);
    clearPreview();
    try {
      const pdf = await convertZplToPdf(zpl, {
        sourceDensity,
        density,
        width: Number((widthCm / 2.54).toFixed(4)),
        height: Number((heightCm / 2.54).toFixed(4)),
        rotation,
        fillWhiteSpace: true,
      }, setProgress);
      const blob = new Blob([pdf as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPdfUrl(url);
      setCurrentStep(3);
    } catch (conversionError) {
      setError(conversionError instanceof Error ? conversionError.message : 'Não foi possível converter o arquivo.');
    } finally {
      setConverting(false);
    }
  }

  function printPdf() {
    const previewWindow = pdfPreviewRef.current?.contentWindow;
    if (!previewWindow) return setError('A pré-visualização ainda não está pronta para imprimir.');
    previewWindow.focus();
    previewWindow.print();
  }

  const progressPercent = progress ? Math.round((progress.completedLabels / progress.totalLabels) * 100) : 0;

  return (
    <main className="flex flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileOutput size={21} className="text-[var(--color-brand)]" />
            <h1 className="text-xl font-semibold text-[var(--color-text)]">ZPL para PDF</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-[var(--color-text-muted)]">
            Converta até 500 etiquetas de uma vez em um único PDF pronto para visualizar, baixar ou imprimir.
          </p>
        </div>
        {currentStep === 2 && (
          <button
            type="button"
            onClick={() => setShowSettings((current) => !current)}
            aria-expanded={showSettings}
            className="flex items-center gap-2 rounded-lg border border-[var(--color-brand)]/30 bg-[var(--color-brand-soft)] px-3 py-2 text-xs font-semibold text-[var(--color-brand)] transition hover:border-[var(--color-brand)]"
          >
            <Settings2 size={15} /> {showSettings ? 'Fechar configurações' : 'Editar configurações'}
          </button>
        )}
      </header>

      <nav aria-label="Etapas da conversão" className="mx-auto grid w-full max-w-3xl grid-cols-3 gap-2">
        {(['Adicionar', 'Converter', 'PDF pronto'] as const).map((label, index) => {
          const step = (index + 1) as 1 | 2 | 3;
          const active = currentStep === step;
          const completed = currentStep > step;
          return (
            <div key={label} className={`rounded-lg border px-3 py-2 text-center text-xs font-semibold transition ${active ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]' : completed ? 'border-[var(--color-good)]/30 bg-[var(--color-good-soft)] text-[var(--color-good)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}>
              <span className="mr-1.5">{completed ? '✓' : step}.</span>{label}
            </div>
          );
        })}
      </nav>

      {currentStep === 1 && (
        <div className="mx-auto w-full max-w-5xl">
          <Card title="1. Adicione as etiquetas">
            <div className="space-y-4">
              <button
                type="button"
                disabled={readingFile}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const file = event.dataTransfer.files[0];
                  if (file) void readFile(file);
                }}
                className={`flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 text-center transition-colors ${dragging ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]' : 'border-[var(--color-border)] hover:border-[var(--color-brand)]'}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip,.zpl,.txt,.prn,application/zip,application/x-zip-compressed,text/plain"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void readFile(file);
                    event.currentTarget.value = '';
                  }}
                />
                {readingFile ? <LoaderCircle size={26} className="animate-spin text-[var(--color-brand)]" /> : <UploadCloud size={26} className="text-[var(--color-brand)]" />}
                <span className="text-sm font-medium text-[var(--color-text)]">
                  {readingFile ? 'Lendo arquivo...' : (fileName ?? 'Selecionar ZIP, ZPL, TXT ou PRN')}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">ZIP: importa somente arquivos que contenham etiquetas ZPL válidas</span>
              </button>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="zpl-code" className="text-sm font-medium text-[var(--color-text)]">Ou cole o código</label>
                  <button type="button" onClick={() => { setZpl(exampleZpl); setFileName(null); clearPreview(); }} className="text-xs font-medium text-[var(--color-brand)] hover:underline">
                    Usar exemplo
                  </button>
                </div>
                <textarea
                  id="zpl-code"
                  value={zpl}
                  onChange={(event) => { setZpl(event.target.value); setFileName(null); clearPreview(); setError(null); }}
                  spellCheck={false}
                  placeholder="^XA ... ^XZ"
                  className="min-h-64 w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4 font-mono text-xs leading-5 text-[var(--color-text)] outline-none transition focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/15"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 text-[var(--color-text-muted)]"><FileCode2 size={14} /> {zpl.length.toLocaleString('pt-BR')} caracteres</span>
                <span className={`font-semibold ${labelCount > MAX_ZPL_LABELS ? 'text-[var(--color-danger)]' : 'text-[var(--color-brand)]'}`}>
                  {labelCount} de {MAX_ZPL_LABELS} etiquetas
                </span>
              </div>

              {/* Sem este resumo, um bloco descartado em silêncio passa
                  despercebido — e se a etiqueta restante tiver ^PQ2, o PDF sai
                  com duas páginas iguais parecendo estar correto. */}
              {blockSummary && (
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                  <p className="text-xs font-semibold text-[var(--color-text)]">
                    {blockSummary.blocks.length} bloco(s) no arquivo · {labelCount} página(s) no PDF
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {blockSummary.blocks.map((block) => (
                      <li key={block.position} className="flex items-start gap-2 text-xs leading-5">
                        <span
                          className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            block.kind === 'label'
                              ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                              : block.kind === 'format'
                                ? 'bg-[var(--color-panel-2)] text-[var(--color-text-muted)]'
                                : 'bg-amber-400/10 text-amber-400'
                          }`}
                        >
                          {block.kind === 'label'
                            ? block.copies > 1 ? `${block.copies} cópias` : 'etiqueta'
                            : block.kind === 'format' ? 'modelo' : 'ignorado'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-[var(--color-text-muted)]">{block.position}. </span>
                          <span className="break-all font-mono text-[11px] text-[var(--color-text)]">{block.preview}</span>
                          {block.reason && (
                            <span className="mt-0.5 block text-[11px] text-[var(--color-text-faint)]">{block.reason}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {blockSummary.duplicated && (
                    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-amber-400">
                      <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                      Atenção: o PDF terá páginas repetidas porque uma etiqueta pede várias cópias (^PQ). Se você esperava etiquetas diferentes, confira os blocos marcados como ignorados acima.
                    </p>
                  )}
                </div>
              )}

              {error && <div role="alert" className="rounded-lg border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

              <button
                type="button"
                onClick={() => { setError(null); setCurrentStep(2); }}
                disabled={readingFile || labelCount < 1 || labelCount > MAX_ZPL_LABELS}
                className="flex w-full items-center justify-center rounded-lg bg-[var(--color-brand)] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continuar com {labelCount} etiqueta(s)
              </button>
            </div>
          </Card>
        </div>
      )}

      {currentStep === 2 && (
        <div className="mx-auto w-full max-w-2xl">
          <Card title="2. Revise e converta">
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4 text-sm">
                <div><div className="text-xs text-[var(--color-text-muted)]">Etiquetas</div><div className="mt-1 font-semibold text-[var(--color-text)]">{labelCount}</div></div>
                <div><div className="text-xs text-[var(--color-text-muted)]">Padrão</div><div className="mt-1 font-semibold text-[var(--color-text)]">{width} × {height} cm · {density === 8 ? 203 : density === 12 ? 300 : 600} DPI</div></div>
              </div>

              {showSettings && (
                <div className="space-y-5 border-b border-[var(--color-border)] pb-5">
                  <label className="block text-sm font-medium text-[var(--color-text)]">Densidade original do ZPL
                    <select value={sourceDensity} onChange={(event) => setSourceDensity(Number(event.target.value) as ZplDensity)} className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"><option value={8}>203 DPI · mais comum</option><option value={12}>300 DPI</option><option value={24}>600 DPI</option></select>
                    <span className="mt-1.5 block text-xs font-normal leading-4 text-[var(--color-text-muted)]">Quando possível, a densidade correta é detectada automaticamente.</span>
                  </label>
                  <label className="block text-sm font-medium text-[var(--color-text)]">Qualidade do PDF
                    <select value={density} onChange={(event) => setDensity(Number(event.target.value) as ZplDensity)} className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"><option value={8}>203 DPI · padrão térmico</option><option value={12}>300 DPI · alta qualidade</option><option value={24}>600 DPI · máxima qualidade</option></select>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm font-medium text-[var(--color-text)]">Largura (cm)<input value={width} onChange={(event) => setWidth(event.target.value)} inputMode="decimal" className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-brand)]" /></label>
                    <label className="text-sm font-medium text-[var(--color-text)]">Altura (cm)<input value={height} onChange={(event) => setHeight(event.target.value)} inputMode="decimal" className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-brand)]" /></label>
                  </div>
                  <label className="block text-sm font-medium text-[var(--color-text)]">Rotação
                    <select value={rotation} onChange={(event) => setRotation(Number(event.target.value) as ZplRotation)} className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"><option value={0}>Sem rotação</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option></select>
                  </label>
                </div>
              )}

              {error && <div role="alert" className="rounded-lg border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

              {converting && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-[var(--color-text-muted)]"><span>Convertendo lote {progress?.batch ?? 1} de {progress?.totalBatches ?? Math.ceil(labelCount / 50)}</span><span>{progressPercent}%</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--color-border-soft)]"><div className="h-full rounded-full bg-[var(--color-brand)] transition-all" style={{ width: `${Math.max(progressPercent, 4)}%` }} /></div>
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                <button type="button" onClick={() => { setCurrentStep(1); setShowSettings(false); }} disabled={converting} className="rounded-lg border border-[var(--color-border)] px-4 py-3 text-sm font-semibold text-[var(--color-text)] transition hover:bg-[var(--color-bg)] disabled:opacity-50">Voltar</button>
                <button type="button" onClick={() => void convert()} disabled={converting} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{converting ? <><LoaderCircle size={17} className="animate-spin" /> Convertendo...</> : <><FileOutput size={17} /> Gerar PDF</>}</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {currentStep === 3 && pdfUrl && (
        <div className="mx-auto w-full max-w-5xl">
          <Card title="3. PDF pronto">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-good)]/25 bg-[var(--color-good-soft)] p-3">
                <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-good)]"><CheckCircle2 size={17} /> {labelCount} etiqueta(s) pronta(s) para impressão</span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => { clearPreview(); setCurrentStep(1); }} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text)]">Nova conversão</button>
                  <button type="button" onClick={printPdf} className="flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"><Printer size={16} /> Imprimir</button>
                </div>
              </div>
              <iframe ref={pdfPreviewRef} title="Pré-visualização do PDF" src={pdfUrl} className="h-[620px] w-full rounded-xl border border-[var(--color-border)] bg-white" />
            </div>
          </Card>
        </div>
      )}
    </main>
  );
}
