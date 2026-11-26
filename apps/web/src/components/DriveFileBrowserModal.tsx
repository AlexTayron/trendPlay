'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DriveFileEntry, DriveFolderEntry } from '@devcore/shared';
import { attachDriveFiles, listDriveItems } from '../lib/api';
import { formatBytes, formatDurationClock } from '../lib/format';

interface Crumb {
  id: string;
  name: string;
}

interface DriveFileBrowserModalProps {
  open: boolean;
  courseId: string;
  initialFolderId?: string | null;
  initialFolderName?: string | null;
  onClose: () => void;
  onFilesAttached: (res: { addedLessons: number; addedDocuments: number }) => void;
  onFallbackPicker: () => void;
}

export function DriveFileBrowserModal({
  open,
  courseId,
  initialFolderId,
  initialFolderName,
  onClose,
  onFilesAttached,
  onFallbackPicker,
}: DriveFileBrowserModalProps) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: 'root', name: 'Meu Drive' }]);
  const [folders, setFolders] = useState<DriveFolderEntry[]>([]);
  const [files, setFiles] = useState<DriveFileEntry[]>([]);
  const [selectedMap, setSelectedMap] = useState<Map<string, DriveFileEntry>>(new Map());
  const [moduleTitle, setModuleTitle] = useState('');
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentCrumb = crumbs[crumbs.length - 1] ?? { id: 'root', name: 'Meu Drive' };

  const fetchItems = useCallback(
    async (folderId: string, resetCrumbs = false) => {
      setLoading(true);
      setError(null);
      try {
        const data = await listDriveItems(folderId);
        setFolders(data.folders);
        setFiles(data.files);
        if (resetCrumbs) {
          if (folderId === 'root') {
            setCrumbs([{ id: 'root', name: 'Meu Drive' }]);
          } else {
            setCrumbs([
              { id: 'root', name: 'Meu Drive' },
              { id: data.parentId, name: data.parentName || initialFolderName || 'Pasta do Curso' },
            ]);
          }
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Não foi possível listar os arquivos do Google Drive.',
        );
        setFolders([]);
        setFiles([]);
      } finally {
        setLoading(false);
      }
    },
    [initialFolderName],
  );

  useEffect(() => {
    if (!open) return;
    setFilter('');
    setError(null);
    setSelectedMap(new Map());
    setModuleTitle('');
    fetchItems(initialFolderId || 'root', true);
  }, [open, initialFolderId, fetchItems]);

  const filteredFolders = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, filter]);

  const filteredFiles = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, filter]);

  if (!open) return null;

  const handleOpenFolder = (folder: DriveFolderEntry) => {
    setFilter('');
    setCrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
    fetchItems(folder.id);
  };

  const handleBreadcrumbClick = (index: number) => {
    const target = crumbs[index];
    if (!target) return;
    setFilter('');
    setCrumbs((prev) => prev.slice(0, index + 1));
    fetchItems(target.id);
  };

  const toggleFile = (file: DriveFileEntry) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(file.id)) {
        next.delete(file.id);
      } else {
        next.set(file.id, file);
      }
      return next;
    });
  };

  const allVisibleSelected =
    filteredFiles.length > 0 && filteredFiles.every((f) => selectedMap.has(f.id));

  const toggleSelectAllVisible = () => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (allVisibleSelected) {
        filteredFiles.forEach((f) => next.delete(f.id));
      } else {
        filteredFiles.forEach((f) => next.set(f.id, f));
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selectedMap.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const targetModule =
        moduleTitle.trim() ||
        (currentCrumb.id !== 'root' ? currentCrumb.name : 'Módulo — Arquivos do Drive');

      const res = await attachDriveFiles(courseId, {
        moduleTitle: targetModule,
        files: Array.from(selectedMap.values()).map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
        })),
      });
      onFilesAttached(res);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao anexar arquivos ao curso.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-surface-container-low border border-outline-variant/30 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[88vh]">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-outline-variant/25 flex items-center justify-between gap-3 bg-surface-container">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-secondary text-[24px]">
              add_to_drive
            </span>
            <div>
              <h2 className="text-base font-bold text-on-surface">
                Adicionar arquivos do Google Drive
              </h2>
              <p className="text-xs text-outline">
                Navegue pelas pastas do seu curso e marque os vídeos, PDFs ou materiais que deseja adicionar.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container-high"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Breadcrumbs */}
        <div className="px-6 py-2.5 border-b border-outline-variant/20 bg-surface-container-lowest flex items-center gap-1 flex-wrap text-xs">
          {crumbs.map((c, idx) => (
            <div key={`${c.id}-${idx}`} className="flex items-center gap-1">
              {idx > 0 && (
                <span className="material-symbols-outlined text-[16px] text-outline">
                  chevron_right
                </span>
              )}
              <button
                onClick={() => handleBreadcrumbClick(idx)}
                className={`px-2 py-1 rounded-md transition-colors ${
                  idx === crumbs.length - 1
                    ? 'bg-primary/15 text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                {c.name}
              </button>
            </div>
          ))}
        </div>

        {/* Filtro + Nome do módulo de destino */}
        <div className="px-6 py-3 border-b border-outline-variant/15 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-center gap-2 bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-3 py-1.5">
            <span className="material-symbols-outlined text-[18px] text-outline">search</span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filtrar em "${currentCrumb.name}"...`}
              className="w-full bg-transparent text-xs text-on-surface placeholder:text-outline focus:outline-none"
            />
          </div>

          <input
            type="text"
            value={moduleTitle}
            onChange={(e) => setModuleTitle(e.target.value)}
            placeholder={`Módulo destino (padrão: ${currentCrumb.name})`}
            className="bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-3 py-1.5 text-xs text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
          />
        </div>

        {error && (
          <div className="mx-6 mt-3 p-3 rounded-lg bg-error/10 border border-error/30 text-error text-xs">
            {error}
          </div>
        )}

        {/* Lista hierárquica de pastas e arquivos */}
        <div className="flex-1 overflow-y-auto px-6 py-3 min-h-[280px] space-y-3">
          {loading ? (
            <div className="h-52 flex flex-col items-center justify-center gap-2 text-outline">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
              <span className="text-xs">Carregando pastas e arquivos...</span>
            </div>
          ) : (
            <>
              {/* Subpastas */}
              {filteredFolders.length > 0 && (
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-wider text-outline mb-1.5">
                    Pastas ({filteredFolders.length})
                  </div>
                  <div className="divide-y divide-outline-variant/15 border border-outline-variant/20 rounded-xl overflow-hidden">
                    {filteredFolders.map((folder) => (
                      <button
                        key={folder.id}
                        onClick={() => handleOpenFolder(folder)}
                        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 bg-surface-container-low hover:bg-surface-container text-left transition-colors group"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="material-symbols-outlined text-amber-300/90 text-[20px] shrink-0">
                            folder
                          </span>
                          <span className="text-sm font-medium text-on-surface group-hover:text-primary truncate">
                            {folder.name}
                          </span>
                        </div>
                        <span className="material-symbols-outlined text-[18px] text-outline group-hover:text-primary shrink-0">
                          chevron_right
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Arquivos selecionáveis */}
              {filteredFiles.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-outline">
                      Arquivos ({filteredFiles.length})
                    </span>
                    <button
                      onClick={toggleSelectAllVisible}
                      className="text-xs text-secondary hover:underline font-medium"
                    >
                      {allVisibleSelected ? 'Desmarcar todos' : 'Selecionar todos desta pasta'}
                    </button>
                  </div>
                  <div className="divide-y divide-outline-variant/15 border border-outline-variant/20 rounded-xl overflow-hidden">
                    {filteredFiles.map((file) => {
                      const checked = selectedMap.has(file.id);
                      const isVideo = file.mimeType.startsWith('video/');
                      const isAudio = file.mimeType.startsWith('audio/');
                      return (
                        <label
                          key={file.id}
                          className={`flex items-center justify-between gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                            checked
                              ? 'bg-primary/15'
                              : 'bg-surface-container-low hover:bg-surface-container'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleFile(file)}
                              className="w-4 h-4 rounded accent-primary-container shrink-0"
                            />
                            <span
                              className={`material-symbols-outlined text-[20px] shrink-0 ${
                                isVideo
                                  ? 'text-secondary'
                                  : isAudio
                                    ? 'text-tertiary'
                                    : 'text-primary'
                              }`}
                            >
                              {isVideo ? 'movie' : isAudio ? 'headphones' : 'description'}
                            </span>
                            <span className="text-xs sm:text-sm text-on-surface truncate">
                              {file.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] font-mono text-outline shrink-0">
                            {file.durationSeconds > 0 && (
                              <span>{formatDurationClock(file.durationSeconds)}</span>
                            )}
                            <span>{formatBytes(file.size)}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {filteredFolders.length === 0 && filteredFiles.length === 0 && (
                <div className="h-44 flex flex-col items-center justify-center text-center text-outline">
                  <span className="material-symbols-outlined text-4xl mb-2 opacity-60">
                    folder_open
                  </span>
                  <p className="text-sm font-medium text-on-surface-variant">
                    Nenhum vídeo ou material compatível nesta pasta
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-outline-variant/20 bg-surface-container flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => {
              onClose();
              onFallbackPicker();
            }}
            className="text-xs text-outline hover:text-on-surface flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
            <span>Abrir Google Picker nativo</span>
          </button>

          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-surface-container-high text-xs text-on-surface-variant hover:text-on-surface"
            >
              Cancelar
            </button>
            <button
              disabled={selectedMap.size === 0 || submitting}
              onClick={handleSubmit}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-container hover:bg-secondary-container text-on-primary-container font-bold text-xs transition-all disabled:opacity-45"
            >
              <span
                className={`material-symbols-outlined text-[16px] ${
                  submitting ? 'animate-spin' : ''
                }`}
              >
                {submitting ? 'progress_activity' : 'add'}
              </span>
              <span>
                {submitting
                  ? 'Adicionando...'
                  : `Adicionar selecionados (${selectedMap.size})`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
