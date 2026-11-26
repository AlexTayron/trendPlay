'use client';

import { useEffect, useState } from 'react';
import type { LessonResource } from '@devcore/shared';
import { getDriveStreamUrl } from '../lib/api';
import { formatBytes } from '../lib/format';

export type MaterialPreviewKind = 'pdf' | 'word' | 'image';

const IMAGE_EXT_REGEX = /\.(png|jpe?g|webp|gif|svg|bmp)$/i;
const PDF_EXT_REGEX = /\.pdf$/i;
const WORD_EXT_REGEX = /\.docx?$/i;

export function getMaterialPreviewKind(resource: LessonResource): MaterialPreviewKind | null {
  const mime = (resource.mimeType || '').toLowerCase();
  const title = resource.title || '';

  if (
    mime === 'application/pdf' ||
    mime.startsWith('application/vnd.google-apps.') ||
    PDF_EXT_REGEX.test(title)
  ) {
    return 'pdf';
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword' ||
    WORD_EXT_REGEX.test(title)
  ) {
    return 'word';
  }

  if (mime.startsWith('image/') || IMAGE_EXT_REGEX.test(title)) {
    return 'image';
  }

  return null;
}

export function getMaterialKindMeta(resource: LessonResource): {
  kind: MaterialPreviewKind | null;
  label: string;
  icon: string;
  badgeClass: string;
} {
  const kind = getMaterialPreviewKind(resource);
  if (kind === 'pdf') {
    return {
      kind,
      label: 'PDF',
      icon: 'picture_as_pdf',
      badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    };
  }
  if (kind === 'word') {
    return {
      kind,
      label: 'WORD',
      icon: 'article',
      badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    };
  }
  if (kind === 'image') {
    return {
      kind,
      label: 'IMAGEM',
      icon: 'image',
      badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    };
  }

  return {
    kind: null,
    label: resource.role.toUpperCase(),
    icon:
      resource.role === 'code'
        ? 'code'
        : resource.role === 'transcript'
          ? 'subtitles'
          : 'description',
    badgeClass: 'bg-surface-container-high text-outline border-outline-variant/25',
  };
}

interface MammothBrowserModule {
  convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
  default?: {
    convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
  };
}

function buildWordSrcDoc(bodyHtml: string, zoomPercent: number): string {
  const scale = Math.max(0.7, Math.min(1.8, zoomPercent / 100));
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #0f1420;
      color: #18202c;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
    }
    .page-stage {
      padding: 20px;
      display: flex;
      justify-content: center;
    }
    .doc-sheet {
      width: 100%;
      max-width: 820px;
      background: #ffffff;
      color: #1e293b;
      border-radius: 10px;
      padding: 32px 36px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
      line-height: 1.65;
      font-size: ${Math.round(15 * scale)}px;
      word-break: break-word;
    }
    h1, h2, h3, h4 { color: #0f172a; margin-top: 1.25em; margin-bottom: 0.5em; line-height: 1.3; }
    h1 { font-size: 1.7em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }
    h2 { font-size: 1.35em; }
    h3 { font-size: 1.15em; }
    p { margin: 0 0 0.85em; }
    ul, ol { margin: 0 0 1em; padding-left: 1.5em; }
    li { margin-bottom: 0.35em; }
    img { max-width: 100%; height: auto; border-radius: 6px; margin: 10px 0; }
    table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 0.92em; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; }
    blockquote {
      border-left: 3px solid #3b82f6;
      margin: 12px 0;
      padding: 6px 14px;
      background: #f8fafc;
      color: #334155;
    }
    code, pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: #f1f5f9;
      border-radius: 4px;
    }
    code { padding: 2px 5px; font-size: 0.9em; }
    pre { padding: 12px; overflow-x: auto; }
  </style>
</head>
<body>
  <div class="page-stage">
    <article class="doc-sheet">${bodyHtml}</article>
  </div>
</body>
</html>`;
}

interface MaterialPreviewPanelProps {
  resource: LessonResource;
  onClose: () => void;
}

export function MaterialPreviewPanel({ resource, onClose }: MaterialPreviewPanelProps) {
  const meta = getMaterialKindMeta(resource);
  const kind = meta.kind;
  const streamUrl = getDriveStreamUrl(resource.driveFileId);
  const downloadUrl = getDriveStreamUrl(resource.driveFileId, true);

  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [wordHtml, setWordHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setZoom(100);
    setWordHtml(null);
    setErrorMsg(null);

    if (kind !== 'word') {
      setLoading(kind === 'image');
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(streamUrl, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) {
          throw new Error(`Não foi possível baixar o arquivo (${res.status}).`);
        }

        const arrayBuffer = await res.arrayBuffer();
        if (cancelled) return;

        // Verifica assinatura PK (OOXML .docx). Arquivos binários .doc legados não são ZIP.
        const header = new Uint8Array(arrayBuffer.slice(0, 2));
        const isZipDocx = header[0] === 0x50 && header[1] === 0x4b;
        if (!isZipDocx) {
          throw new Error(
            'Este arquivo está no formato Word antigo (.doc). Use o botão "Baixar" acima para abri-lo.',
          );
        }

        const mod = (await import('mammoth/mammoth.browser')) as unknown as MammothBrowserModule;
        const convertToHtml = mod.convertToHtml || mod.default?.convertToHtml;
        if (!convertToHtml) {
          throw new Error('Conversor de documentos Word indisponível.');
        }

        const result = await convertToHtml({ arrayBuffer });
        if (cancelled) return;
        setWordHtml(result.value || '<p><em>Documento sem conteúdo textual visível.</em></p>');
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : 'Não foi possível renderizar este documento Word.',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [kind, streamUrl]);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpanded(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  const panelBody = (
    <div
      className={`flex flex-col rounded-2xl bg-[#0b1019] border border-outline-variant/30 overflow-hidden shadow-2xl ${
        expanded ? 'w-full h-full' : 'h-[620px]'
      }`}
    >
      {/* Cabeçalho do Leitor */}
      <div className="px-3.5 py-2.5 bg-surface-container/90 border-b border-outline-variant/25 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`px-2 py-0.5 rounded-md border text-[10px] font-mono font-bold shrink-0 ${meta.badgeClass}`}
          >
            {meta.label}
          </span>
          <span className="text-xs font-semibold text-on-surface truncate" title={resource.title}>
            {resource.title}
          </span>
          {resource.byteSize > 0 && (
            <span className="text-[10px] font-mono text-outline shrink-0 hidden xl:inline">
              · {formatBytes(resource.byteSize)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {(kind === 'image' || kind === 'word') && (
            <div className="flex items-center gap-0.5 mr-1 bg-surface-container-lowest rounded-lg p-0.5 border border-outline-variant/20">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(50, z - 25))}
                title="Diminuir zoom"
                className="p-1 rounded hover:bg-surface-container-high text-on-surface-variant"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                  zoom_out
                </span>
              </button>
              <button
                type="button"
                onClick={() => setZoom(100)}
                title="Resetar zoom"
                className="px-1.5 text-[10px] font-mono text-on-surface-variant hover:text-white"
              >
                {zoom}%
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(200, z + 25))}
                title="Aumentar zoom"
                className="p-1 rounded hover:bg-surface-container-high text-on-surface-variant"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                  zoom_in
                </span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            title={expanded ? 'Recolher leitor (Esc)' : 'Expandir leitor em tela cheia'}
            className="p-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>
              {expanded ? 'close_fullscreen' : 'open_in_full'}
            </span>
          </button>

          <a
            href={streamUrl}
            target="_blank"
            rel="noreferrer"
            title="Abrir em nova aba"
            className="p-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>
              open_in_new
            </span>
          </a>

          <a
            href={downloadUrl}
            title="Baixar arquivo"
            className="p-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>
              download
            </span>
          </a>

          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              onClose();
            }}
            title="Fechar leitor"
            className="p-1.5 rounded-lg bg-surface-container hover:bg-error/20 text-on-surface-variant hover:text-error transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>
              close
            </span>
          </button>
        </div>
      </div>

      {/* Área de Visualização */}
      <div className="relative flex-1 min-h-0 bg-[#0b1019] overflow-auto">
        {kind === 'pdf' && (
          <iframe
            key={resource.driveFileId}
            src={streamUrl}
            title={resource.title}
            className="w-full h-full border-0 bg-[#1a1f2c]"
          />
        )}

        {kind === 'image' && (
          <div className="w-full h-full flex items-center justify-center p-4 overflow-auto">
            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-outline pointer-events-none">
                <span className="material-symbols-outlined text-primary animate-spin">
                  progress_activity
                </span>
                <span className="text-xs">Carregando imagem...</span>
              </div>
            )}
            {errorMsg ? (
              <div className="text-center p-6 max-w-sm">
                <span className="material-symbols-outlined text-3xl text-amber-300 mb-2">
                  broken_image
                </span>
                <p className="text-xs text-slate-300">{errorMsg}</p>
              </div>
            ) : (
              <img
                src={streamUrl}
                alt={resource.title}
                onLoad={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setErrorMsg('Não foi possível carregar esta imagem do Google Drive.');
                }}
                style={{ width: zoom === 100 ? 'auto' : `${zoom}%`, maxWidth: zoom <= 100 ? '100%' : 'none' }}
                className="max-h-full object-contain rounded-lg shadow-xl transition-all"
              />
            )}
          </div>
        )}

        {kind === 'word' && (
          <div className="w-full h-full">
            {loading ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-outline">
                <span className="material-symbols-outlined text-secondary animate-spin">
                  progress_activity
                </span>
                <span className="text-xs">Convertendo documento Word...</span>
              </div>
            ) : errorMsg ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
                <span className="material-symbols-outlined text-4xl text-sky-300 mb-2">
                  article
                </span>
                <p className="text-xs text-slate-300 max-w-md leading-relaxed">{errorMsg}</p>
                <a
                  href={downloadUrl}
                  className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-container text-on-primary-container text-xs font-semibold"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                    download
                  </span>
                  <span>Baixar arquivo</span>
                </a>
              </div>
            ) : wordHtml ? (
              <iframe
                title={resource.title}
                sandbox=""
                srcDoc={buildWordSrcDoc(wordHtml, zoom)}
                className="w-full h-full border-0 bg-[#0f1420]"
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );

  if (expanded) {
    return (
      <div
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 lg:p-6 flex items-center justify-center"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setExpanded(false);
          }
        }}
      >
        <div className="w-full max-w-6xl h-[90vh]">{panelBody}</div>
      </div>
    );
  }

  return panelBody;
}
