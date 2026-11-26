'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DriveFileEntry,
  DriveFolderEntry,
  ImportDriveFolderResult,
  ImportRootFolderResult,
} from '@devcore/shared';
import {
  importDriveFolder,
  importDriveMovieFile,
  importRootCoursesFolder,
  listDriveItems,
} from '../lib/api';
import { formatBytes, formatDurationClock } from '../lib/format';

const SAVED_STREAMING_ROOT_KEY = 'devcore_saved_streaming_root';

interface SavedRootFolder {
  id: string;
  name: string;
}

interface Crumb {
  id: string;
  name: string;
}

interface DriveStreamingBrowserModalProps {
  open: boolean;
  onClose: () => void;
  onItemImported: (result: ImportDriveFolderResult) => void;
  onRootImported: (result: ImportRootFolderResult) => void;
}

function isVideoEntry(file: DriveFileEntry): boolean {
  if (file.mimeType.startsWith('video/')) return true;
  return /\.(mp4|mkv|webm|mov|m4v|avi|ogv)$/i.test(file.name);
}

export function DriveStreamingBrowserModal({
  open,
  onClose,
  onItemImported,
  onRootImported,
}: DriveStreamingBrowserModalProps) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: 'root', name: 'Meu Drive' }]);
  const [folders, setFolders] = useState<DriveFolderEntry[]>([]);
  const [files, setFiles] = useState<DriveFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedRoot, setSavedRoot] = useState<SavedRootFolder | null>(null);

  const currentCrumb = crumbs[crumbs.length - 1] ?? { id: 'root', name: 'Meu Drive' };

  const fetchItems = useCallback(async (folderId: string, resetToRoot = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listDriveItems(folderId);
      setFolders(data.folders);
      setFiles(data.files.filter(isVideoEntry));
      if (resetToRoot) {
        if (folderId === 'root') {
          setCrumbs([{ id: 'root', name: 'Meu Drive' }]);
        } else {
          setCrumbs([
            { id: 'root', name: 'Meu Drive' },
            { id: data.parentId, name: data.parentName },
          ]);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Não foi possível listar seus arquivos do Google Drive.',
      );
      setFolders([]);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setFilter('');
    setError(null);
    let initialId = 'root';
    try {
      const raw = window.localStorage.getItem(SAVED_STREAMING_ROOT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedRootFolder;
        if (parsed?.id) {
          setSavedRoot(parsed);
          initialId = parsed.id;
        }
      }
    } catch {
      // ignora
    }
    fetchItems(initialId, true);
  }, [open, fetchItems]);

  const filteredFolders = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, filter]);

  const filteredVideos = useMemo(() => {
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

  const handleSaveRoot = () => {
    if (currentCrumb.id === 'root') return;
    const next: SavedRootFolder = { id: currentCrumb.id, name: currentCrumb.name };
    setSavedRoot(next);
    try {
      window.localStorage.setItem(SAVED_STREAMING_ROOT_KEY, JSON.stringify(next));
    } catch {
      // ignora
    }
  };

  const handleClearRoot = () => {
    setSavedRoot(null);
    try {
      window.localStorage.removeItem(SAVED_STREAMING_ROOT_KEY);
    } catch {
      // ignora
    }
  };

  const handleImportFolderAuto = async (folderId: string, folderName: string) => {
    setBusyId(folderId);
    setError(null);
    try {
      const result = await importDriveFolder({
        folderId,
        folderName,
        contentType: 'auto',
      });
      onItemImported(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao importar pasta de streaming.');
    } finally {
      setBusyId(null);
    }
  };

  const handleImportSingleMovie = async (file: DriveFileEntry) => {
    setBusyId(file.id);
    setError(null);
    try {
      const result = await importDriveMovieFile({
        fileId: file.id,
        fileName: file.name,
      });
      onItemImported(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao importar filme.');
    } finally {
      setBusyId(null);
    }
  };

  const handleImportAllInCurrent = async () => {
    setBusyId('__ALL__');
    setError(null);
    try {
      const result = await importRootCoursesFolder(currentCrumb.id, 'auto');
      onRootImported(result);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro ao importar todos os filmes/séries desta pasta.',
      );
    } finally {
      setBusyId(null);
    }
  };

  const isSavedCurrent = savedRoot?.id === currentCrumb.id;
  const totalInCurrent = folders.length + files.length;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-surface-container-low border border-fuchsia-500/25 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[86vh]">
        {/* Header */}
        <div className="px-3.5 sm:px-6 py-3 sm:py-4 border-b border-outline-variant/25 flex items-center justify-between gap-2.5 bg-gradient-to-r from-[#171124] via-surface-container to-surface-container">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="material-symbols-outlined text-fuchsia-400 text-[22px] sm:text-[24px] shrink-0">
              movie
            </span>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-on-surface truncate">
                Adicionar Filmes e Séries (Google Drive)
              </h2>
              <p className="text-[11px] sm:text-xs text-outline leading-snug">
                Arquivo único vira <strong className="text-fuchsia-300">Filme</strong> · Pasta com
                temporadas/episódios vira <strong className="text-rose-300">Série</strong>.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="p-1.5 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container-high shrink-0"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Breadcrumbs + Pasta Favorita de Streaming */}
        <div className="px-3.5 sm:px-6 py-2.5 border-b border-outline-variant/20 bg-surface-container-lowest flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 flex-wrap text-xs">
            {crumbs.map((c, idx) => (
              <div key={`${c.id}-${idx}`} className="flex items-center gap-1">
                {idx > 0 && (
                  <span className="material-symbols-outlined text-[15px] text-outline">
                    chevron_right
                  </span>
                )}
                <button
                  onClick={() => handleBreadcrumbClick(idx)}
                  className={`px-2 py-1 rounded-md transition-colors max-w-[190px] sm:max-w-none truncate ${
                    idx === crumbs.length - 1
                      ? 'bg-fuchsia-500/15 text-fuchsia-300 font-semibold'
                      : 'text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  {c.name}
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {currentCrumb.id !== 'root' && !isSavedCurrent && (
              <button
                onClick={handleSaveRoot}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-[11px] text-fuchsia-300 font-medium"
                title="Abrir sempre direto nesta pasta no modo Streaming"
              >
                <span className="material-symbols-outlined text-[14px]">push_pin</span>
                <span className="sm:hidden">Fixar pasta</span>
                <span className="hidden sm:inline">Fixar pasta de Streaming</span>
              </button>
            )}
            {isSavedCurrent && (
              <button
                onClick={handleClearRoot}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[11px] text-emerald-300 font-medium"
                title="Clique para desafixar"
              >
                <span className="material-symbols-outlined text-[14px]">keep</span>
                <span>Pasta fixada</span>
              </button>
            )}
          </div>
        </div>

        {/* Busca + Ações em lote */}
        <div className="px-3.5 sm:px-6 py-2.5 sm:py-3 border-b border-outline-variant/15 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="flex-1 flex items-center gap-2 bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-3 py-2 sm:py-1.5">
            <span className="material-symbols-outlined text-[18px] text-outline shrink-0">
              search
            </span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filtrar em "${currentCrumb.name}"...`}
              className="w-full bg-transparent text-xs text-on-surface placeholder:text-outline focus:outline-none"
            />
          </div>

          {currentCrumb.id !== 'root' && (
            <div className="grid grid-cols-2 sm:flex items-center gap-2 shrink-0">
              <button
                disabled={busyId !== null}
                onClick={() => handleImportFolderAuto(currentCrumb.id, currentCrumb.name)}
                className="px-3 py-2 sm:py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-xs font-medium text-on-surface text-center disabled:opacity-50"
                title="Importa esta pasta como 1 Série (com temporadas) ou 1 Filme"
              >
                {busyId === currentCrumb.id ? 'Importando...' : 'Importar esta pasta'}
              </button>

              {totalInCurrent > 0 && (
                <button
                  disabled={busyId !== null}
                  onClick={handleImportAllInCurrent}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 sm:px-3.5 sm:py-1.5 rounded-lg bg-gradient-to-r from-fuchsia-600 to-rose-600 hover:from-fuchsia-500 hover:to-rose-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
                  title="Importa cada subpasta e cada vídeo solto como um item separado no catálogo"
                >
                  <span
                    className={`material-symbols-outlined text-[16px] shrink-0 ${
                      busyId === '__ALL__' ? 'animate-spin' : ''
                    }`}
                  >
                    {busyId === '__ALL__' ? 'progress_activity' : 'library_add'}
                  </span>
                  <span className="truncate">
                    {busyId === '__ALL__'
                      ? `Importando (${totalInCurrent})...`
                      : `Todos (${totalInCurrent})`}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="mx-3.5 sm:mx-6 mt-3 p-3 rounded-lg bg-error/10 border border-error/30 text-error text-xs">
            {error}
          </div>
        )}

        {/* Lista de Pastas e Vídeos */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 min-h-[280px] space-y-4">
          {loading ? (
            <div className="h-52 flex flex-col items-center justify-center gap-2 text-outline">
              <span className="material-symbols-outlined text-3xl text-fuchsia-400 animate-spin">
                progress_activity
              </span>
              <span className="text-xs">Carregando pastas e vídeos do Google Drive...</span>
            </div>
          ) : filteredFolders.length === 0 && filteredVideos.length === 0 ? (
            <div className="h-52 flex flex-col items-center justify-center text-center text-outline px-4">
              <span className="material-symbols-outlined text-4xl mb-2 opacity-60">
                movie_filter
              </span>
              <p className="text-sm font-medium text-on-surface-variant">
                {filter
                  ? 'Nenhum item encontrado com esse filtro'
                  : 'Nenhuma pasta ou vídeo encontrado aqui'}
              </p>
            </div>
          ) : (
            <>
              {/* Pastas (Série ou Pasta de Filme) */}
              {filteredFolders.length > 0 && (
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-wider text-outline mb-1.5">
                    Pastas ({filteredFolders.length}) — toque para abrir ou importe como Série/Filme
                  </div>
                  <div className="divide-y divide-outline-variant/15 border border-outline-variant/20 rounded-xl overflow-hidden">
                    {filteredFolders.map((folder) => {
                      const isImporting = busyId === folder.id;
                      return (
                        <div
                          key={folder.id}
                          className="flex items-center justify-between gap-2.5 sm:gap-3 px-3 sm:px-4 py-3 sm:py-2.5 bg-surface-container-low hover:bg-surface-container transition-colors"
                        >
                          <button
                            onClick={() => handleOpenFolder(folder)}
                            disabled={busyId !== null}
                            className="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-0 flex-1 text-left group"
                          >
                            <span className="material-symbols-outlined text-amber-300/90 text-[22px] shrink-0 mt-0.5 sm:mt-0">
                              folder
                            </span>
                            <div className="min-w-0 flex-1">
                              <span className="block text-[13px] sm:text-sm font-medium text-on-surface group-hover:text-fuchsia-300 leading-snug break-words line-clamp-2">
                                {folder.name}
                              </span>
                            </div>
                            <span className="material-symbols-outlined text-[16px] text-outline/70 shrink-0 mt-0.5 sm:mt-0">
                              chevron_right
                            </span>
                          </button>

                          <button
                            onClick={() => handleImportFolderAuto(folder.id, folder.name)}
                            disabled={busyId !== null}
                            className="shrink-0 flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg bg-fuchsia-500/15 hover:bg-fuchsia-500/25 text-fuchsia-300 border border-fuchsia-500/30 text-[11px] sm:text-xs font-semibold transition-all disabled:opacity-50"
                          >
                            <span
                              className={`material-symbols-outlined text-[15px] ${
                                isImporting ? 'animate-spin' : ''
                              }`}
                            >
                              {isImporting ? 'progress_activity' : 'download'}
                            </span>
                            <span>{isImporting ? '...' : 'Importar'}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Vídeos individuais -> Filme */}
              {filteredVideos.length > 0 && (
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-wider text-outline mb-1.5">
                    Arquivos de Vídeo ({filteredVideos.length}) — adicione direto como Filme
                  </div>
                  <div className="divide-y divide-outline-variant/15 border border-outline-variant/20 rounded-xl overflow-hidden">
                    {filteredVideos.map((video) => {
                      const isImporting = busyId === video.id;
                      return (
                        <div
                          key={video.id}
                          className="flex items-center justify-between gap-2.5 sm:gap-3 px-3 sm:px-4 py-3 sm:py-2.5 bg-surface-container-low hover:bg-surface-container transition-colors"
                        >
                          <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                            <span className="material-symbols-outlined text-rose-400 text-[22px] shrink-0 mt-0.5 sm:mt-0">
                              theaters
                            </span>
                            <div className="min-w-0 flex-1">
                              <span className="block text-[13px] sm:text-sm font-medium text-on-surface leading-snug break-words line-clamp-2">
                                {video.name}
                              </span>
                              <div className="flex items-center gap-2 text-[10px] font-mono text-outline mt-0.5">
                                {video.durationSeconds > 0 && (
                                  <span>{formatDurationClock(video.durationSeconds)}</span>
                                )}
                                <span>{formatBytes(video.size)}</span>
                              </div>
                            </div>
                          </div>

                          <button
                            onClick={() => handleImportSingleMovie(video)}
                            disabled={busyId !== null}
                            className="shrink-0 flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-[11px] sm:text-xs font-semibold transition-all disabled:opacity-50"
                          >
                            <span
                              className={`material-symbols-outlined text-[15px] ${
                                isImporting ? 'animate-spin' : ''
                              }`}
                            >
                              {isImporting ? 'progress_activity' : 'add'}
                            </span>
                            <span>{isImporting ? '...' : 'Filme'}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-3.5 sm:px-6 py-3 border-t border-outline-variant/20 bg-surface-container flex items-center justify-between gap-2 text-xs">
          <span className="text-[11px] text-outline truncate">
            Pastas com subpastas de temporadas viram Séries automaticamente.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-on-surface shrink-0"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
