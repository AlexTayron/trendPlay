'use client';

import { useState } from 'react';
import type { ImportDriveFolderResult } from '@devcore/shared';
import { importYoutubePlaylist } from '../lib/api';

interface YouTubeImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: (result: ImportDriveFolderResult) => void;
}

export function YouTubeImportModal({ open, onClose, onImported }: YouTubeImportModalProps) {
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playlistUrl.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await importYoutubePlaylist({
        playlistUrl: playlistUrl.trim(),
        customTitle: customTitle.trim() || undefined,
      });
      setPlaylistUrl('');
      setCustomTitle('');
      onImported(result);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Não foi possível importar a playlist do YouTube.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-2xl bg-surface-container-low border border-outline-variant/30 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-outline-variant/25 flex items-center justify-between bg-surface-container">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-red-400 text-[24px]">
              smart_display
            </span>
            <div>
              <h2 className="text-base font-bold text-on-surface">
                Importar Playlist do YouTube
              </h2>
              <p className="text-xs text-outline">
                Cada vídeo da playlist vira uma aula com progresso, Autoplay, velocidade e notas.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container-high"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-error/10 border border-error/30 text-error text-xs leading-relaxed">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
              Link ou ID da Playlist *
            </label>
            <input
              type="text"
              required
              autoFocus
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              placeholder="https://www.youtube.com/playlist?list=PL..."
              className="w-full rounded-xl bg-surface-container-lowest border border-outline-variant/30 px-3.5 py-2.5 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
            />
            <p className="text-[11px] text-outline mt-1.5">
              Funciona com playlists públicas ou não listadas (também aceita link de vídeo com{' '}
              <code className="font-mono">&amp;list=...</code>).
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
              Nome do curso (opcional)
            </label>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Deixe vazio para usar o título original da playlist"
              className="w-full rounded-xl bg-surface-container-lowest border border-outline-variant/30 px-3.5 py-2.5 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-outline-variant/20 bg-surface-container flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-surface-container-high text-xs text-on-surface-variant hover:text-on-surface"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || !playlistUrl.trim()}
            className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-red-500 hover:bg-red-400 text-white font-bold text-xs transition-all disabled:opacity-50"
          >
            <span
              className={`material-symbols-outlined text-[16px] ${loading ? 'animate-spin' : ''}`}
            >
              {loading ? 'progress_activity' : 'playlist_add'}
            </span>
            <span>{loading ? 'Carregando playlist...' : 'Importar Playlist'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
