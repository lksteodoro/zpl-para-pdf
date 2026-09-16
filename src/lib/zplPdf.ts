export const MAX_ZPL_LABELS = 500;
const LABELS_PER_REQUEST = 50;
const MAX_REQUEST_BYTES = 1_000_000;
const LABELARY_ENDPOINT = 'https://api.labelary.com/v1/printers';

export type ZplDensity = 8 | 12 | 24;
export type ZplRotation = 0 | 90 | 180 | 270;

export interface ZplPdfOptions {
  sourceDensity: ZplDensity;
  density: ZplDensity;
  width: number;
  height: number;
  rotation: ZplRotation;
  fillWhiteSpace: boolean;
}

export interface ZplConversionProgress {
  completedLabels: number;
  totalLabels: number;
  batch: number;
  totalBatches: number;
}

interface ParsedZpl {
  labels: string[];
  prefix: string;
}

/**
 * O que o conversor fez com cada bloco `^XA…^XZ` do arquivo.
 *
 * Nem todo bloco vira etiqueta: alguns são só configuração da impressora e
 * outros são modelos reaproveitados. Antes esse descarte era silencioso, e a
 * combinação "um bloco ignorado + outro com ^PQ2" produzia duas páginas iguais
 * sem nenhuma pista de que uma das etiquetas do arquivo tinha sumido.
 */
export type ZplBlockKind = 'label' | 'format' | 'ignored';

export interface ZplBlockInfo {
  /** Posição do bloco no arquivo, contando a partir de 1. */
  position: number;
  kind: ZplBlockKind;
  /** Quantas páginas este bloco gera no PDF. */
  copies: number;
  /** Texto do primeiro campo, para a pessoa reconhecer a etiqueta. */
  preview: string;
  /** Por que o bloco não virou etiqueta. */
  reason?: string;
}

interface PdfContentBounds {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

function detectSourceDensity(zpl: string, options: ZplPdfOptions): ZplDensity {
  const firstLabel = extractPrintableZplBlocks(zpl)[0];
  if (!firstLabel) return options.sourceDensity;
  const widthDots = Number(firstLabel.match(/\^PW\s*(\d+)/i)?.[1]);
  const heightDots = Number(firstLabel.match(/\^LL\s*(\d+)/i)?.[1]);
  const estimates = [
    widthDots > 0 ? widthDots / (options.width * 25.4) : 0,
    heightDots > 0 ? heightDots / (options.height * 25.4) : 0,
  ].filter((value) => value > 0 && Number.isFinite(value));
  if (estimates.length === 0) return options.sourceDensity;

  const candidates: ZplDensity[] = [8, 12, 24];
  const detect = (estimate: number) => candidates.reduce((closest, candidate) =>
    Math.abs(candidate - estimate) < Math.abs(closest - estimate) ? candidate : closest,
  );
  const detections = estimates.map(detect);
  if (detections.every((density) => density === detections[0])) return detections[0];

  // ^PW representa a largura física com mais consistência que ^LL, que muitos
  // emissores deixam maior que o conteúdo. Quando divergem, priorize a largura.
  return widthDots > 0 ? detect(widthDots / (options.width * 25.4)) : detections[0];
}

function isPrintableLabel(block: string) {
  if (/\^DF(?:R:|E:|B:|A:)?/i.test(block)) return false;
  return /\^(?:FD|FV|SN|GF[ABC]?|GB|GC|GD|XG|XF|B[0234789ACEIKLMNOPQRSUXZ])/i.test(block);
}

export function extractPrintableZplBlocks(zpl: string) {
  return [...zpl.matchAll(/\^XA[\s\S]*?\^XZ/gi)]
    .map((match) => match[0])
    .filter(isPrintableLabel)
    .filter((block) => Number(block.match(/\^PQ\s*(\d+)/i)?.[1] ?? 1) !== 0);
}

/** Um bloco `^DF` guarda um modelo que as etiquetas seguintes recuperam com `^XF`. */
function isFormatDownload(block: string) {
  return /\^DF(?:R:|E:|B:|A:)?/i.test(block);
}

function blockQuantity(block: string) {
  const match = block.match(/\^PQ\s*(\d+)/i);
  return match ? Number(match[1]) : 1;
}

/** Primeiro texto imprimível do bloco, para identificar a etiqueta na tela. */
function blockPreview(block: string) {
  const field = block.match(/\^FD([^^]*?)\^FS/i)?.[1]?.trim();
  if (field) return field.slice(0, 60);
  return block.replace(/\s+/g, ' ').slice(0, 60);
}

/** Descreve o destino de cada bloco do arquivo, sem convertê-lo. */
export function analyzeZpl(zpl: string): ZplBlockInfo[] {
  return [...zpl.matchAll(/\^XA[\s\S]*?\^XZ/gi)].map((match, index) => {
    const block = match[0];
    const position = index + 1;
    const preview = blockPreview(block);

    if (isFormatDownload(block)) {
      return { position, kind: 'format', copies: 0, preview, reason: 'Modelo reaproveitado pelas etiquetas que usam ^XF.' };
    }
    if (!isPrintableLabel(block)) {
      return { position, kind: 'ignored', copies: 0, preview, reason: 'Bloco só de configuração da impressora: não gera etiqueta.' };
    }
    const quantity = blockQuantity(block);
    if (quantity === 0) {
      return { position, kind: 'ignored', copies: 0, preview, reason: 'O próprio arquivo pede zero cópias (^PQ0).' };
    }
    return { position, kind: 'label', copies: quantity, preview };
  });
}

function splitZpl(zpl: string): ParsedZpl {
  const labelPattern = /\^XA[\s\S]*?\^XZ/gi;
  const matches = [...zpl.matchAll(labelPattern)];
  if (matches.length === 0) {
    throw new Error('Nenhuma etiqueta válida foi encontrada. Verifique os comandos ^XA e ^XZ.');
  }

  const labels: string[] = [];
  // Modelos ^DF precisam chegar ao renderizador antes das etiquetas que os
  // recuperam com ^XF. Descartá-los fazia essas etiquetas saírem sem o layout.
  const formats: string[] = [];

  for (const match of matches) {
    const label = match[0];
    if (isFormatDownload(label)) {
      formats.push(label);
      continue;
    }
    if (!isPrintableLabel(label)) continue;
    const quantity = blockQuantity(label);
    if (quantity === 0) continue;
    const quantityMatch = label.match(/\^PQ\s*(\d+)/i);
    const singleLabel = quantityMatch ? label.replace(/\^PQ\s*\d+/i, '^PQ1') : label;
    if (labels.length + quantity > MAX_ZPL_LABELS) {
      throw new Error(`O arquivo gera mais de ${MAX_ZPL_LABELS} etiquetas. Reduza o lote e tente novamente.`);
    }
    for (let copy = 0; copy < quantity; copy += 1) labels.push(singleLabel);
  }

  if (labels.length === 0) {
    throw new Error('Os blocos ZPL encontrados não contêm etiquetas imprimíveis.');
  }

  const header = zpl.slice(0, matches[0].index ?? 0);
  return {
    labels,
    prefix: formats.length > 0 ? `${header}${formats.join('\n')}\n` : header,
  };
}

export function countZplLabels(zpl: string): number {
  if (!zpl.trim()) return 0;
  return analyzeZpl(zpl).reduce((total, block) => total + block.copies, 0);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function crc16Ccitt(value: string) {
  const bytes = new TextEncoder().encode(value);
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

async function compressHexGraphic(hex: string) {
  const normalized = hex.replace(/\s/g, '');
  if (normalized.length < 2 || normalized.length % 2 !== 0) return null;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    const value = Number.parseInt(normalized.slice(index, index + 2), 16);
    if (!Number.isFinite(value)) return null;
    bytes[index / 2] = value;
  }

  const compressedStream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  const compressed = new Uint8Array(await new Response(compressedStream).arrayBuffer());
  const encoded = bytesToBase64(compressed);
  return `:Z64:${encoded}:${crc16Ccitt(encoded)}`;
}

/** Compacta imagens hexadecimais sem alterar sua resolução ou aparência. */
async function optimizeZplPayload(zpl: string) {
  const pattern = /\^GFA,\s*(\d+),\s*(\d+),\s*(\d+),\s*([0-9A-F\s]+)(?=\^)/gi;
  const matches = [...zpl.matchAll(pattern)];
  if (matches.length === 0) return zpl;

  let optimized = '';
  let cursor = 0;
  for (const match of matches) {
    const index = match.index ?? cursor;
    optimized += zpl.slice(cursor, index);
    const compressed = await compressHexGraphic(match[4]);
    const replacement = compressed
      ? `^GFA,${match[1]},${match[2]},${match[3]},${compressed}`
      : match[0];
    optimized += replacement.length < match[0].length ? replacement : match[0];
    cursor = index + match[0].length;
  }
  return optimized + zpl.slice(cursor);
}

async function requestLabelary(
  zpl: string,
  options: ZplPdfOptions,
  density: ZplDensity,
  accept: 'application/pdf' | 'application/zpl',
  attempt = 0,
): Promise<Response> {
  if (new Blob([zpl]).size > MAX_REQUEST_BYTES) {
    throw new Error('A etiqueta continua acima de 1 MB mesmo após a compactação automática das imagens.');
  }

  const response = await fetch(
    `${LABELARY_ENDPOINT}/${density}dpmm/labels/${options.width}x${options.height}/`,
    {
      method: 'POST',
      headers: {
        Accept: accept,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Rotation': accept === 'application/pdf' ? String(options.rotation) : '0',
        ...(accept === 'application/zpl' ? { 'X-Target-Dpmm': String(options.density) } : {}),
      },
      body: zpl,
    },
  );

  if (response.status === 429 && attempt < 2) {
    const retryAfter = Math.max(1, Number(response.headers.get('Retry-After')) || 1);
    await wait(retryAfter * 1_000);
    return requestLabelary(zpl, options, density, accept, attempt + 1);
  }

  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail || `Falha na conversão (HTTP ${response.status}).`);
  }

  return response;
}

async function renderBatch(zpl: string, options: ZplPdfOptions): Promise<ArrayBuffer> {
  const optimizedSource = await optimizeZplPayload(zpl);
  let renderableZpl = optimizedSource;
  const remoteDensities: ZplDensity[] = [24, 12, 8];
  const longestSideInches = Math.max(options.width, options.height);
  const sourceFitsRemoteLimit = longestSideInches * 25.4 * options.sourceDensity <= 2_000;
  const renderDensity = sourceFitsRemoteLimit
    ? options.sourceDensity
    : remoteDensities.find((density) => longestSideInches * 25.4 * density <= 2_000) ?? 8;

  // 203/300 DPI são enviados diretamente. A resolução final é aplicada
  // localmente, eliminando uma chamada externa e a espera entre requisições.
  if (options.sourceDensity !== renderDensity) {
    const intermediateOptions = { ...options, density: renderDensity };
    const transformed = await requestLabelary(
      optimizedSource,
      intermediateOptions,
      options.sourceDensity,
      'application/zpl',
    );
    const transformedZpl = await optimizeZplPayload(await transformed.text());
    if (new Blob([transformedZpl]).size <= MAX_REQUEST_BYTES) {
      renderableZpl = transformedZpl;
    }
  }

  const response = await requestLabelary(
    renderableZpl,
    options,
    renderDensity,
    'application/pdf',
  );
  return response.arrayBuffer();
}

async function detectPageContentBounds(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof import('pdfjs-dist/legacy/build/pdf.mjs')['getDocument']>['promise']>['getPage']>>,
): Promise<PdfContentBounds> {
  const originalViewport = page.getViewport({ scale: 1 });
  const scale = Math.max(0.75, 520 / Math.max(originalViewport.width, originalViewport.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return { left: 0, bottom: 0, right: originalViewport.width, top: originalViewport.height };

  await page.render({ canvas, viewport, background: '#ffffff' }).promise;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4;
      if (data[offset] < 246 || data[offset + 1] < 246 || data[offset + 2] < 246) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  canvas.width = 1;
  canvas.height = 1;
  if (maxX < minX || maxY < minY) {
    return { left: 0, bottom: 0, right: originalViewport.width, top: originalViewport.height };
  }

  const padding = 5 / scale;
  return {
    left: Math.max(0, minX / scale - padding),
    bottom: Math.max(0, originalViewport.height - (maxY + 1) / scale - padding),
    right: Math.min(originalViewport.width, (maxX + 1) / scale + padding),
    top: Math.min(originalViewport.height, originalViewport.height - minY / scale + padding),
  };
}

async function renderHighQualityLabel(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof import('pdfjs-dist/legacy/build/pdf.mjs')['getDocument']>['promise']>['getPage']>>,
  bounds: PdfContentBounds,
  targetWidth: number,
  targetHeight: number,
) {
  const baseViewport = page.getViewport({ scale: 1 });
  const boundsWidth = Math.max(1, bounds.right - bounds.left);
  const boundsHeight = Math.max(1, bounds.top - bounds.bottom);
  const scale = Math.max(targetWidth / boundsWidth, targetHeight / boundsHeight, 1);
  const viewport = page.getViewport({ scale });
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = Math.ceil(viewport.width);
  sourceCanvas.height = Math.ceil(viewport.height);
  await page.render({ canvas: sourceCanvas, viewport, background: '#ffffff' }).promise;

  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = targetWidth;
  targetCanvas.height = targetHeight;
  const context = targetCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Não foi possível preparar a etiqueta para impressão.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  // Uma área de segurança mínima evita que traços encostados no limite do ZPL
  // sejam recortados pelo visualizador ou pela margem física da impressora.
  const safeInsetX = Math.max(2, Math.round(targetWidth * 0.0025));
  const safeInsetY = Math.max(4, Math.round(targetHeight * 0.004));

  const cropX = bounds.left * scale;
  const cropY = (baseViewport.height - bounds.top) * scale;
  const cropWidth = boundsWidth * scale;
  const cropHeight = boundsHeight * scale;
  context.drawImage(
    sourceCanvas,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    safeInsetX,
    safeInsetY,
    targetWidth - safeInsetX * 2,
    targetHeight - safeInsetY * 2,
  );

  const blob = await new Promise<Blob>((resolve, reject) => {
    targetCanvas.toBlob((result) => result ? resolve(result) : reject(new Error('Falha ao finalizar a imagem da etiqueta.')), 'image/png');
  });
  sourceCanvas.width = 1;
  sourceCanvas.height = 1;
  targetCanvas.width = 1;
  targetCanvas.height = 1;
  return new Uint8Array(await blob.arrayBuffer());
}

async function appendPdfPages(
  output: import('pdf-lib').PDFDocument,
  rendered: ArrayBuffer,
  options: ZplPdfOptions,
) {
  const { PDFDocument } = await import('pdf-lib');
  const source = await PDFDocument.load(rendered);
  if (!options.fillWhiteSpace) {
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
    return;
  }

  const [pdfjs, workerModule] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
  const inspectionBytes = new Uint8Array(rendered.slice(0));
  const inspectionTask = pdfjs.getDocument({ data: inspectionBytes });
  const inspection = await inspectionTask.promise;
  const sampleIndexes = [...new Set([1, Math.ceil(inspection.numPages / 2), inspection.numPages])];
  const sampledBounds = await Promise.all(
    sampleIndexes.map(async (pageNumber) => detectPageContentBounds(await inspection.getPage(pageNumber))),
  );
  const [firstBounds, ...remainingBounds] = sampledBounds;
  const bounds = remainingBounds.reduce<PdfContentBounds>((combined, current) => ({
    left: Math.min(combined.left, current.left),
    bottom: Math.min(combined.bottom, current.bottom),
    right: Math.max(combined.right, current.right),
    top: Math.max(combined.top, current.top),
  }), firstBounds);

  const targetWidth = options.width * 72;
  const targetHeight = options.height * 72;
  const isStandardBrazil = Math.abs(options.width * 2.54 - 11) < 0.02
    && Math.abs(options.height * 2.54 - 15) < 0.02;
  // Cada dpmm vira um ponto real da imagem. Assim, 300 DPI produz 1320 × 1800
  // no padrão 11 × 15 cm e mantém o antialias criado pelo renderizador.
  const targetPixelWidth = Math.round(options.width * options.density * 25.4);
  const targetPixelHeight = Math.round(options.height * options.density * 25.4);
  const horizontalInset = isStandardBrazil ? 0.4287 : 0;
  const pageCount = source.getPageCount();
  const parallelPages = options.density === 24 ? 1 : 2;
  for (let start = 0; start < pageCount; start += parallelPages) {
    const indexes = Array.from(
      { length: Math.min(parallelPages, pageCount - start) },
      (_, offset) => start + offset,
    );
    const renderedPages = await Promise.all(indexes.map(async (index) => {
      const inspectionPage = await inspection.getPage(index + 1);
      return renderHighQualityLabel(inspectionPage, bounds, targetPixelWidth, targetPixelHeight);
    }));
    for (const labelPng of renderedPages) {
      const embedded = await output.embedPng(labelPng);
      const targetPage = output.addPage([targetWidth, targetHeight]);
      targetPage.drawImage(embedded, {
        x: horizontalInset,
        y: 0,
        width: targetWidth - horizontalInset * 2,
        height: targetHeight,
      });
    }
  }
  // A API de limpeza mudou entre versões do PDF.js. A conversão já terminou,
  // então a liberação de recursos deve ser opcional e nunca invalidar o PDF.
  try {
    if (typeof inspectionTask.destroy === 'function') {
      await inspectionTask.destroy();
    } else if (typeof inspection.cleanup === 'function') {
      await inspection.cleanup();
    }
  } catch {
    // Limpeza de worker em melhor esforço; não altera o arquivo já gerado.
  }
}

export async function convertZplToPdf(
  zpl: string,
  options: ZplPdfOptions,
  onProgress?: (progress: ZplConversionProgress) => void,
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const effectiveOptions = {
    ...options,
    sourceDensity: detectSourceDensity(zpl, options),
  };
  const preparedZpl = zpl;
  const { labels, prefix } = splitZpl(preparedZpl);
  const batches: string[][] = [];
  for (let index = 0; index < labels.length; index += LABELS_PER_REQUEST) {
    batches.push(labels.slice(index, index + LABELS_PER_REQUEST));
  }

  const output = await PDFDocument.create();
  let completedLabels = 0;

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const rendered = await renderBatch(`${prefix}${batch.join('\n')}`, effectiveOptions);
    await appendPdfPages(output, rendered, effectiveOptions);
    completedLabels += batch.length;
    onProgress?.({
      completedLabels,
      totalLabels: labels.length,
      batch: index + 1,
      totalBatches: batches.length,
    });
    if (index < batches.length - 1) await wait(360);
  }

  return output.save({ useObjectStreams: true });
}
