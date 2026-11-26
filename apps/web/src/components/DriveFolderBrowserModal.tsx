'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DriveFolderEntry,
  ImportDriveFolderResult,
  ImportRootFolderResult,
} from '@devcore/shared';
import {
  importDriveFolder,
  importRootCoursesFolder,
  listDriveFolders,
} from '../lib/api';

const SAVED_ROOT_KEY = 'devcore_saved_courses_root';

interface SavedRootFolder {
  id: string;
  name: string;
}

interface Crumb {
  id: string;
  name: string;
}

interface DriveFolderBrowserModalProps {
  open: boolean;
  onClose: () => void;
  onCourseImported: (result: ImportDriveFolderResult) => void;
  onRootImported: (result: ImportRootFolderResult) => void;
  onFallbackPicker: () => void;
}

export function DriveFolderBrowserModal({
  open,
  onClose,
  onCourseImported,
  onRootImported,
  onFallbackPicker,
}: DriveFolderBrowserModalProps) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: 'root', name: 'Meu Drive' }]);
  const [folders, setFolders] = useState<DriveFolderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedRoot, setSavedRoot] = useState<SavedRootFolder | null>(null);

  const currentCrumb = crumbs[crumbs.length - 1] ?? { id: 'root', name: 'Meu Drive' };

  const fetchFolder = useCallback(async (folderId: string, resetToRoot = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listDriveFolders(folderId);
      setFolders(data.folders);
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
          : 'Não foi possível listar as pastas do Google Drive.',
      );
      setFolders([]);
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
      const raw = window.localStorage.getItem(SAVED_ROOT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedRootFolder;
        if (parsed?.id) {
          setSavedRoot(parsed);
          initialId = parsed.id;
        }
      }
    } catch {
      // ignora erro de localStorage
    }
    fetchFolder(initialId, true);
  }, [open, fetchFolder]);

  const filteredFolders = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, filter]);

  if (!open) return null;

  const handleOpenFolder = (folder: DriveFolderEntry) => {
    setFilter('');
    setCrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
    fetchFolder(folder.id);
  };

  const handleBreadcrumbClick = (index: number) => {
    const target = crumbs[index];
    if (!target) return;
    setFilter('');
    setCrumbs((prev) => prev.slice(0, index + 1));
    fetchFolder(target.id);
  };

  const handleSaveAsCoursesRoot = () => {
    if (currentCrumb.id === 'root') return;
    const next: SavedRootFolder = { id: currentCrumb.id, name: currentCrumb.name };
    setSavedRoot(next);
    try {
      window.localStorage.setItem(SAVED_ROOT_KEY, JSON.stringify(next));
    } catch {
      // ignora
    }
  };

  const handleClearSavedRoot = () => {
    setSavedRoot(null);
    try {
      window.localStorage.removeItem(SAVED_ROOT_KEY);
    } catch {
      // ignora
    }
  };

  const handleImportSingle = async (folderId: string, folderName: string) => {
    setBusyId(folderId);
    setError(null);
    try {
      const result = await importDriveFolder({ folderId, folderName });
      onCourseImported(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao importar curso.');
    } finally {
      setBusyId(null);
    }
  };

  const handleImportAllSubfolders = async () => {
    setBusyId('__ALL__');
    setError(null);
    try {
      const result = await importRootCoursesFolder(currentCrumb.id);
      onRootImported(result);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro ao importar todos os cursos desta pasta.',
      );
    } finally {
      setBusyId(null);
    }
  };

  const isSavedCurrent = savedRoot?.id === currentCrumb.id;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-surface-container-low border border-outline-variant/30 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[85vh]">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-outline-variant/25 flex items-center justify-between gap-3 bg-surface-container">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-primary text-[24px]">
              folder_open
            </span>
            <div>
              <h2 className="text-base font-bold text-on-surface">
                Explorador do Google Drive
              </h2>
              <p className="text-xs text-outline">
                Navegue até sua pasta organizada de cursos — importe um curso ou todos de uma vez.
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

        {/* Breadcrumbs + Pasta Favorita */}
        <div className="px-6 py-3 border-b border-outline-variant/20 bg-surface-container-lowest flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 flex-wrap text-xs">
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

          <div className="flex items-center gap-2">
            {currentCrumb.id !== 'root' && !isSavedCurrent && (
              <button
                onClick={handleSaveAsCoursesRoot}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-[11px] text-secondary font-medium"
                title="Abrir sempre direto nesta pasta ao importar cursos"
              >
                <span className="material-symbols-outlined text-[14px]">push_pin</span>
                <span>Fixar como minha pasta de Cursos</span>
              </button>
            )}
            {isSavedCurrent && (
              <button
                onClick={handleClearSavedRoot}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[11px] text-emerald-300 font-medium"
                title="Clique para desafixar"
              >
                <span className="material-symbols-outlined text-[14px]">keep</span>
                <span>Pasta de Cursos fixada</span>
              </button>
            )}
          </div>
        </div>

        {/* Barra de busca + Ações da pasta atual */}
        <div className="px-6 py-3 border-b border-outline-variant/15 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex-1 flex items-center gap-2 bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-3 py-1.5">
            <span className="material-symbols-outlined text-[18px] text-outline">search</span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filtrar pastas dentro de "${currentCrumb.name}"...`}
              className="w-full bg-transparent text-xs text-on-surface placeholder:text-outline focus:outline-none"
            />
          </div>

          {currentCrumb.id !== 'root' && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                disabled={busyId !== null}
                onClick={() => handleImportSingle(currentCrumb.id, currentCrumb.name)}
                className="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-xs font-medium text-on-surface disabled:opacity-50"
              >
                {busyId === currentCrumb.id ? 'Importando...' : 'Importar esta pasta'}
              </button>

              {folders.length > 0 && (
                <button
                  disabled={busyId !== null}
                  onClick={handleImportAllSubfolders}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary-container hover:bg-secondary-container text-on-primary-container text-xs font-bold transition-colors disabled:opacity-50"
                >
                  <span
                    className={`material-symbols-outlined text-[16px] ${
                      busyId === '__ALL__' ? 'animate-spin' : ''
                    }`}
                  >
                    {busyId === '__ALL__' ? 'progress_activity' : 'library_add'}
                  </span>
                  <span>
                    {busyId === '__ALL__'
                      ? `Importando ${folders.length} cursos...`
                      : `Importar todos (${folders.length})`}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Erro */}
        {error && (
          <div className="mx-6 mt-3 p-3 rounded-lg bg-error/10 border border-error/30 text-error text-xs">
            {error}
          </div>
        )}

        {/* Lista de Pastas */}
        <div className="flex-1 overflow-y-auto px-6 py-3 min-h-[280px]">
          {loading ? (
            <div className="h-52 flex flex-col items-center justify-center gap-2 text-outline">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
              <span className="text-xs">Listando pastas do Google Drive...</span>
            </div>
          ) : filteredFolders.length === 0 ? (
            <div className="h-52 flex flex-col items-center justify-center text-center text-outline px-6">
              <span className="material-symbols-outlined text-4xl mb-2 opacity-60">
                folder_off
              </span>
              <p className="text-sm font-medium text-on-surface-variant">
                {filter
                  ? 'Nenhuma pasta encontrada com esse filtro'
                  : 'Esta pasta não contém subpastas'}
              </p>
              {!filter && currentCrumb.id !== 'root' && (
                <p className="text-xs text-outline mt-1">
                  Se os vídeos das aulas já estão aqui dentro, clique em{' '}
                  <strong className="text-on-surface">Importar esta pasta</strong> acima.
                </p>
              )}
              {!filter && currentCrumb.id === 'root' && (
                <p className="text-xs text-amber-300/90 mt-2 max-w-md">
                  Se você acabou de mudar o escopo para <code className="font-mono">drive.readonly</code>,
                  clique em <strong>Sair</strong> no topo e reconecte sua conta Google para listar suas pastas.
                </p>
              )}
            </div>
          ) : (
            <div className="divide-y divide-outline-variant/15 border border-outline-variant/20 rounded-xl overflow-hidden">
              {filteredFolders.map((folder) => {
                const isImportingThis = busyId === folder.id;
                return (
                  <div
                    key={folder.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 bg-surface-container-low hover:bg-surface-container transition-colors"
                  >
                    <button
                      onClick={() => handleOpenFolder(folder)}
                      disabled={busyId !== null}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left group"
                    >
                      <span className="material-symbols-outlined text-amber-300/90 text-[22px] shrink-0">
                        folder
                      </span>
                      <span className="text-sm font-medium text-on-surface group-hover:text-primary truncate">
                        {folder.name}
                      </span>
                      <span className="material-symbols-outlined text-[16px] text-outline opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        arrow_forward
                      </span>
                    </button>

                    <button
                      onClick={() => handleImportSingle(folder.id, folder.name)}
                      disabled={busyId !== null}
                      className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-secondary/15 hover:bg-secondary/25 text-secondary border border-secondary/30 text-xs font-semibold transition-all disabled:opacity-50"
                    >
                      <span
                        className={`material-symbols-outlined text-[15px] ${
                          isImportingThis ? 'animate-spin' : ''
                        }`}
                      >
                        {isImportingThis ? 'progress_activity' : 'download'}
                      </span>
                      <span>{isImportingThis ? 'Importando...' : 'Importar curso'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-outline-variant/20 bg-surface-container flex items-center justify-between gap-3 text-xs">
          <button
            onClick={() => {
              onClose();
              onFallbackPicker();
            }}
            className="text-outline hover:text-on-surface flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
            <span>Abrir Google Picker nativo</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-on-surface"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
