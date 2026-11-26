'use client';

import { useEffect, useRef, useState } from 'react';
import type { ContentType, CourseSummary } from '@devcore/shared';
import { resolveThumbnailUrl, updateCourse } from '../lib/api';

interface EditableCourse {
  id: string;
  title: string;
  contentType?: ContentType;
  instructorName?: string | null;
  description?: string | null;
  thumbnailUrl?: string | null;
  sourceType?: 'drive' | 'youtube';
}

interface CourseEditModalProps {
  course: EditableCourse | null;
  onClose: () => void;
  onSaved: (updated: CourseSummary) => void;
}

/**
 * Redimensiona e comprime a imagem escolhida para 16:9 leve (máx. 960px de largura)
 * diretamente no navegador antes de enviar à API.
 */
async function compressImageToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selecione um arquivo de imagem válido (PNG, JPG, WebP ou GIF).');
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('A imagem original é muito grande (máximo 15 MB).');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Não foi possível ler esta imagem.'));
      el.src = objectUrl;
    });

    const maxWidth = 960;
    const maxHeight = 540;
    let targetW = img.naturalWidth || img.width;
    let targetH = img.naturalHeight || img.height;

    if (targetW > maxWidth || targetH > maxHeight) {
      const ratio = Math.min(maxWidth / targetW, maxHeight / targetH);
      targetW = Math.max(1, Math.round(targetW * ratio));
      targetH = Math.max(1, Math.round(targetH * ratio));
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas indisponível no navegador.');
    }
    ctx.drawImage(img, 0, 0, targetW, targetH);

    let dataUrl = canvas.toDataURL('image/webp', 0.84);
    if (!dataUrl.startsWith('data:image/webp')) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    }

    if (dataUrl.length > 1_400_000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    }

    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function CourseEditModal({ course, onClose, onSaved }: CourseEditModalProps) {
  const [title, setTitle] = useState('');
  const [instructor, setInstructor] = useState('');
  const [description, setDescription] = useState('');
  const [contentType, setContentType] = useState<ContentType>('course');
  const [thumbnailValue, setThumbnailValue] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [processingImg, setProcessingImg] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!course) return;
    setTitle(course.title || '');
    setInstructor(course.instructorName || '');
    setDescription(course.description || '');
    setContentType(course.contentType || 'course');
    const initialThumb = course.thumbnailUrl || '';
    setThumbnailValue(initialThumb);
    setUrlInput(/^https?:\/\//i.test(initialThumb) ? initialThumb : '');
    setError(null);
    setPreviewError(false);
  }, [course]);

  if (!course) return null;

  const resolvedPreview = resolveThumbnailUrl(thumbnailValue);

  const handleFilePicked = async (file: File | null | undefined) => {
    if (!file) return;
    setError(null);
    setPreviewError(false);
    setProcessingImg(true);
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setThumbnailValue(dataUrl);
      setUrlInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar imagem.');
    } finally {
      setProcessingImg(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleUrlChange = (nextUrl: string) => {
    setUrlInput(nextUrl);
    setPreviewError(false);
    setError(null);
    setThumbnailValue(nextUrl.trim());
  };

  const handleRemoveCover = () => {
    setThumbnailValue('');
    setUrlInput('');
    setPreviewError(false);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateCourse(course.id, {
        title: title.trim(),
        instructorName: instructor,
        description,
        thumbnailUrl: thumbnailValue,
        contentType: course.sourceType === 'youtube' ? undefined : contentType,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar alterações do curso.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-2xl bg-surface-container-low border border-outline-variant/30 p-4 sm:p-6 space-y-4 shadow-2xl my-auto max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-primary text-[20px]">edit</span>
            <h2 className="text-sm sm:text-base font-bold text-on-surface truncate">
              Editar curso e capa
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container-high"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Capa do Curso (Preview + Upload + URL) */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-semibold text-on-surface-variant">
              Capa do curso (16:9)
            </label>
            {thumbnailValue && (
              <button
                type="button"
                onClick={handleRemoveCover}
                className="text-[11px] text-error/90 hover:text-error flex items-center gap-1"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                  delete
                </span>
                <span>Remover capa</span>
              </button>
            )}
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFilePicked(e.dataTransfer.files?.[0]);
            }}
            className="relative aspect-video w-full rounded-xl overflow-hidden bg-surface-container-lowest border border-dashed border-outline-variant/40 flex items-center justify-center group"
          >
            {resolvedPreview && !previewError ? (
              <>
                <img
                  src={resolvedPreview}
                  alt={title || 'Capa do curso'}
                  onError={() => setPreviewError(true)}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3.5 py-2 rounded-xl bg-primary-container text-on-primary-container text-xs font-semibold flex items-center gap-1.5 shadow-lg"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                      upload
                    </span>
                    <span>Trocar imagem</span>
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-1.5 p-4 text-center text-outline hover:text-on-surface transition-colors w-full h-full"
              >
                <span className="material-symbols-outlined text-3xl text-primary/80">
                  add_photo_alternate
                </span>
                <span className="text-xs font-medium text-on-surface-variant">
                  {processingImg
                    ? 'Otimizando imagem...'
                    : 'Clique ou arraste uma imagem para enviar'}
                </span>
                <span className="text-[10px] text-outline">
                  PNG, JPG ou WebP — otimizada automaticamente
                </span>
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => handleFilePicked(e.target.files?.[0])}
          />

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <button
              type="button"
              disabled={processingImg}
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-xs font-medium text-on-surface flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50"
            >
              <span
                className={`material-symbols-outlined ${processingImg ? 'animate-spin' : ''}`}
                style={{ fontSize: '16px' }}
              >
                {processingImg ? 'progress_activity' : 'upload'}
              </span>
              <span>{processingImg ? 'Otimizando...' : 'Enviar imagem'}</span>
            </button>

            <input
              type="url"
              value={urlInput}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="Ou cole a URL da imagem (https://...)"
              className="flex-1 rounded-lg bg-surface-container-lowest border border-outline-variant/30 px-3 py-2 text-xs text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
            />
          </div>

          {course.sourceType !== 'youtube' && (
            <p className="text-[11px] text-outline leading-snug">
              Dica: no Google Drive, basta colocar um arquivo{' '}
              <code className="font-mono text-secondary">capa.jpg</code> ou{' '}
              <code className="font-mono text-secondary">cover.png</code> na pasta do curso e clicar
              em <strong className="text-on-surface-variant">Sincronizar</strong>.
            </p>
          )}
        </div>

        {error && (
          <div className="p-2.5 rounded-lg bg-error/10 border border-error/30 text-error text-xs">
            {error}
          </div>
        )}

        {course.sourceType !== 'youtube' && (
          <div>
            <label className="block text-xs text-on-surface-variant mb-1.5">Tipo de conteúdo</label>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-surface-container-lowest border border-outline-variant/25">
              {(
                [
                  { id: 'course', label: 'Curso', icon: 'school' },
                  { id: 'movie', label: 'Filme', icon: 'theaters' },
                  { id: 'series', label: 'Série', icon: 'live_tv' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setContentType(opt.id)}
                  className={`py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                    contentType === opt.id
                      ? opt.id === 'course'
                        ? 'bg-primary-container text-on-primary-container shadow'
                        : 'bg-gradient-to-r from-fuchsia-600 to-rose-600 text-white shadow'
                      : 'text-outline hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                    {opt.icon}
                  </span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-on-surface-variant mb-1">Título</label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant/30 px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="block text-xs text-on-surface-variant mb-1">
            {contentType === 'course' ? 'Instrutor (opcional)' : 'Diretor / Ano / Gênero (opcional)'}
          </label>
          <input
            type="text"
            value={instructor}
            onChange={(e) => setInstructor(e.target.value)}
            placeholder={
              contentType === 'course' ? 'Ex.: Rodrigo Branas' : 'Ex.: Christopher Nolan · 2014'
            }
            className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant/30 px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="block text-xs text-on-surface-variant mb-1">
            {contentType === 'course' ? 'Descrição' : 'Sinopse'}
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant/30 px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant/20">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs text-on-surface-variant"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || processingImg}
            className="px-4 py-2 rounded-lg bg-primary-container hover:bg-secondary-container text-on-primary-container font-semibold text-xs disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>
      </form>
    </div>
  );
}
