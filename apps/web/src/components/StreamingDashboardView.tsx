'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ContinueWatchingItem, CourseSummary } from '@devcore/shared';
import { getGoogleAuthUrl, resolveThumbnailUrl } from '../lib/api';
import { formatDurationClock, formatWatchTime } from '../lib/format';

interface StreamingDashboardViewProps {
  items: CourseSummary[];
  continueWatching: ContinueWatchingItem | null;
  driveConnected: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  syncingId: string | null;
  onOpenStreamingBrowser: () => void;
  onSyncItem: (item: CourseSummary) => void;
  onEditItem: (item: CourseSummary) => void;
}

export function StreamingDashboardView({
  items,
  continueWatching,
  driveConnected,
  searchQuery,
  onSearchChange,
  syncingId,
  onOpenStreamingBrowser,
  onSyncItem,
  onEditItem,
}: StreamingDashboardViewProps) {
  const [typeFilter, setTypeFilter] = useState<'all' | 'movie' | 'series'>('all');

  const moviesCount = useMemo(() => items.filter((i) => i.contentType === 'movie').length, [items]);
  const seriesCount = useMemo(() => items.filter((i) => i.contentType === 'series').length, [items]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (typeFilter !== 'all' && item.contentType !== typeFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        (item.instructorName || '').toLowerCase().includes(q) ||
        (item.description || '').toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery, typeFilter]);

  const featuredItem = useMemo(() => {
    if (continueWatching) {
      const found = items.find((i) => i.id === continueWatching.courseId);
      if (found) return found;
    }
    return items[0] ?? null;
  }, [continueWatching, items]);

  const featuredThumb = resolveThumbnailUrl(featuredItem?.thumbnailUrl);

  const inProgressItems = useMemo(
    () =>
      items.filter(
        (i) =>
          (i.watchedSeconds > 0 || i.completedLessonsCount > 0) &&
          i.progressPercent < 100,
      ),
    [items],
  );

  return (
    <div className="space-y-6 sm:space-y-8 mt-4">
      {/* Hero Cinematográfico */}
      <section className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-[#140b1f] via-[#121024] to-[#0a0f1c] border border-fuchsia-500/20 shadow-2xl">
        {featuredThumb && (
          <div className="absolute inset-0 pointer-events-none">
            <img
              src={featuredThumb}
              alt={featuredItem?.title || 'Destaque'}
              className="w-full h-full object-cover opacity-25 scale-105 blur-[1px]"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0b0a14] via-[#0b0a14]/85 to-[#0b0a14]/40" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0b0a14] via-transparent to-transparent" />
          </div>
        )}

        <div className="relative z-10 p-5 sm:p-8 lg:p-10 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="max-w-2xl min-w-0">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-fuchsia-500/15 border border-fuchsia-500/30 text-fuchsia-300 text-[11px] font-mono font-semibold uppercase tracking-wider mb-3">
              <span className="material-symbols-outlined text-[15px]">movie</span>
              <span>Modo Streaming · Filmes &amp; Séries</span>
            </div>

            {featuredItem ? (
              <>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                      featuredItem.contentType === 'movie'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : 'bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30'
                    }`}
                  >
                    {featuredItem.contentType === 'movie' ? 'Filme' : 'Série'}
                  </span>
                  {featuredItem.contentType === 'series' && (
                    <span className="text-xs font-mono text-slate-300">
                      {featuredItem.modulesCount}{' '}
                      {featuredItem.modulesCount === 1 ? 'temporada' : 'temporadas'} ·{' '}
                      {featuredItem.lessonsCount}{' '}
                      {featuredItem.lessonsCount === 1 ? 'episódio' : 'episódios'}
                    </span>
                  )}
                  {featuredItem.totalDurationSeconds > 0 && (
                    <span className="text-xs font-mono text-slate-400">
                      · {formatWatchTime(featuredItem.totalDurationSeconds)}
                    </span>
                  )}
                </div>

                <h1 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight">
                  {featuredItem.title}
                </h1>

                {continueWatching && continueWatching.courseId === featuredItem.id && (
                  <p className="text-xs sm:text-sm text-slate-300 mt-2">
                    {featuredItem.contentType === 'series' ? (
                      <>
                        <span className="text-fuchsia-300 font-semibold">
                          {continueWatching.moduleTitle}:
                        </span>{' '}
                        {continueWatching.lessonTitle}
                      </>
                    ) : continueWatching.lastPositionSeconds > 0 ? (
                      <>
                        Parou em{' '}
                        <span className="font-mono text-rose-300 font-semibold">
                          {formatDurationClock(continueWatching.lastPositionSeconds)}
                        </span>
                      </>
                    ) : (
                      featuredItem.description || 'Pronto para assistir no player cinema.'
                    )}
                  </p>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Link
                    href={
                      featuredItem.lastLessonId
                        ? `/courses/${featuredItem.id}?lesson=${featuredItem.lastLessonId}`
                        : `/courses/${featuredItem.id}`
                    }
                    className="inline-flex items-center gap-2 px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-fuchsia-600 to-rose-600 hover:from-fuchsia-500 hover:to-rose-500 text-white font-bold text-xs sm:text-sm transition-all shadow-lg"
                  >
                    <span
                      className="material-symbols-outlined text-[20px]"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      play_arrow
                    </span>
                    <span>
                      {featuredItem.watchedSeconds > 0 ? 'Continuar assistindo' : 'Assistir agora'}
                    </span>
                  </Link>

                  <button
                    type="button"
                    onClick={() => onEditItem(featuredItem)}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 sm:py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs sm:text-sm font-medium transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">image</span>
                    <span>Capa / Info</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
                  Seu cinema pessoal direto do Google Drive.
                </h1>
                <p className="text-slate-300 text-sm sm:text-base mt-2.5 leading-relaxed">
                  Importe arquivos individuais como <strong className="text-white">Filmes</strong>{' '}
                  ou pastas organizadas por temporadas como{' '}
                  <strong className="text-white">Séries</strong> — com progresso sincronizado
                  entre computador e celular.
                </p>
              </>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {driveConnected ? (
              <button
                type="button"
                onClick={onOpenStreamingBrowser}
                className="w-full sm:w-auto justify-center flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl bg-white hover:bg-slate-100 text-slate-950 font-bold text-xs sm:text-sm transition-all shadow-lg"
              >
                <span className="material-symbols-outlined text-[20px]">add_to_drive</span>
                <span>Adicionar Filme ou Série</span>
              </button>
            ) : (
              <a
                href={getGoogleAuthUrl()}
                className="w-full sm:w-auto justify-center flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs sm:text-sm"
              >
                <span className="material-symbols-outlined text-[18px]">cloud_sync</span>
                <span>Reconectar Drive</span>
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Busca Mobile */}
      <div className="sm:hidden">
        <div className="flex items-center bg-surface-container-low px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-outline focus-within:border-fuchsia-400/60">
          <span className="material-symbols-outlined text-[18px] mr-2">search</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar filmes e séries..."
            className="bg-transparent text-xs text-on-surface placeholder:text-outline focus:outline-none w-full"
          />
        </div>
      </div>

      {/* Faixa Continuar Assistindo (se houver mais de 1 em andamento) */}
      {inProgressItems.length > 0 && (
        <section>
          <h2 className="text-sm sm:text-base font-bold text-white mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-rose-400 text-[20px]">history</span>
            <span>Continuar assistindo</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {inProgressItems.slice(0, 4).map((item) => {
              const thumb = resolveThumbnailUrl(item.thumbnailUrl);
              const barPct =
                item.contentType === 'movie' && item.totalDurationSeconds > 0
                  ? Math.min(100, Math.round((item.watchedSeconds / item.totalDurationSeconds) * 100))
                  : item.progressPercent;
              return (
                <Link
                  key={item.id}
                  href={
                    item.lastLessonId
                      ? `/courses/${item.id}?lesson=${item.lastLessonId}`
                      : `/courses/${item.id}`
                  }
                  className="group rounded-xl overflow-hidden bg-surface-container-low border border-outline-variant/25 hover:border-fuchsia-500/45 transition-all shadow-md"
                >
                  <div className="relative aspect-video bg-gradient-to-br from-[#1d122c] to-[#0f131c] flex items-center justify-center overflow-hidden">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={item.title}
                        className="w-full h-full object-cover opacity-85 group-hover:opacity-100 group-hover:scale-105 transition-all duration-300"
                      />
                    ) : (
                      <span className="material-symbols-outlined text-4xl text-fuchsia-400/60">
                        {item.contentType === 'movie' ? 'theaters' : 'live_tv'}
                      </span>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                    <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-black/70 text-fuchsia-200">
                        {item.contentType === 'movie' ? 'Filme' : item.lastModuleTitle || 'Série'}
                      </span>
                      <span className="text-[10px] font-mono text-white/90">{barPct}%</span>
                    </div>
                    <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
                      <div
                        className="h-full bg-gradient-to-r from-fuchsia-500 to-rose-500"
                        style={{ width: `${Math.max(4, barPct)}%` }}
                      />
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-fuchsia-300 transition-colors">
                      {item.title}
                    </div>
                    {item.contentType === 'series' && item.lastLessonTitle && (
                      <div className="text-[11px] text-outline truncate mt-0.5">
                        {item.lastLessonTitle}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Catálogo com Filtro: Todos | Filmes | Séries */}
      <section>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-on-surface">
              Catálogo de Streaming ({filteredItems.length})
            </h2>
            <p className="text-xs text-outline mt-0.5">
              {moviesCount} {moviesCount === 1 ? 'filme' : 'filmes'} · {seriesCount}{' '}
              {seriesCount === 1 ? 'série' : 'séries'} no seu Google Drive
            </p>
          </div>

          <div className="inline-flex p-1 rounded-xl bg-surface-container border border-outline-variant/25 self-start sm:self-auto">
            {(
              [
                { id: 'all', label: `Todos (${items.length})` },
                { id: 'movie', label: `Filmes (${moviesCount})` },
                { id: 'series', label: `Séries (${seriesCount})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTypeFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  typeFilter === tab.id
                    ? 'bg-gradient-to-r from-fuchsia-600 to-rose-600 text-white shadow'
                    : 'text-outline hover:text-on-surface'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-fuchsia-500/30 bg-surface-container-low/60 p-10 sm:p-12 text-center flex flex-col items-center">
            <span className="material-symbols-outlined text-5xl text-fuchsia-400/80 mb-3">
              theaters
            </span>
            <h3 className="text-base sm:text-lg font-bold text-on-surface">
              {searchQuery
                ? 'Nenhum filme ou série encontrado'
                : 'Seu catálogo de Streaming ainda está vazio'}
            </h3>
            <p className="text-xs sm:text-sm text-outline max-w-md mt-1.5 leading-relaxed">
              {searchQuery
                ? 'Tente buscar por outro título ou limpe o filtro.'
                : 'Clique abaixo para navegar pelo seu Google Drive: escolha um arquivo de vídeo para adicionar como Filme ou uma pasta com temporadas para adicionar como Série.'}
            </p>
            {!searchQuery && driveConnected && (
              <button
                type="button"
                onClick={onOpenStreamingBrowser}
                className="mt-6 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-fuchsia-600 to-rose-600 hover:from-fuchsia-500 hover:to-rose-500 text-white font-semibold text-sm transition-all shadow-lg"
              >
                <span className="material-symbols-outlined text-[20px]">add_to_drive</span>
                <span>Adicionar Filmes ou Séries do Drive</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filteredItems.map((item) => {
              const thumb = resolveThumbnailUrl(item.thumbnailUrl);
              const isSyncing = syncingId === item.id;
              const isMovie = item.contentType === 'movie';
              const watchPct =
                isMovie && item.totalDurationSeconds > 0
                  ? Math.min(100, Math.round((item.watchedSeconds / item.totalDurationSeconds) * 100))
                  : item.progressPercent;

              return (
                <div
                  key={item.id}
                  className="group rounded-2xl bg-surface-container-low border border-outline-variant/25 hover:border-fuchsia-500/45 transition-all overflow-hidden flex flex-col justify-between shadow-lg"
                >
                  <div>
                    <Link
                      href={
                        item.lastLessonId
                          ? `/courses/${item.id}?lesson=${item.lastLessonId}`
                          : `/courses/${item.id}`
                      }
                      className="block relative aspect-video w-full overflow-hidden bg-gradient-to-br from-[#1d122c] via-[#131424] to-[#0a0f1c]"
                    >
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={item.title}
                          className="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-fuchsia-400/50 gap-1">
                          <span className="material-symbols-outlined text-5xl">
                            {isMovie ? 'theaters' : 'live_tv'}
                          </span>
                          <span className="text-[10px] font-mono uppercase tracking-widest">
                            {isMovie ? 'Filme' : 'Série'}
                          </span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-surface-container-low via-transparent to-black/30" />

                      <span
                        className={`absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase backdrop-blur-md ${
                          isMovie
                            ? 'bg-rose-600/85 text-white'
                            : 'bg-fuchsia-600/85 text-white'
                        }`}
                      >
                        {isMovie ? 'Filme' : 'Série'}
                      </span>

                      {watchPct > 0 && (
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
                          <div
                            className="h-full bg-gradient-to-r from-fuchsia-500 to-rose-500"
                            style={{ width: `${watchPct}%` }}
                          />
                        </div>
                      )}
                    </Link>

                    <div className="p-4 pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={
                            item.lastLessonId
                              ? `/courses/${item.id}?lesson=${item.lastLessonId}`
                              : `/courses/${item.id}`
                          }
                          className="min-w-0 flex-1"
                        >
                          <h3 className="text-base font-bold text-on-surface group-hover:text-fuchsia-300 transition-colors line-clamp-2 leading-snug">
                            {item.title}
                          </h3>
                        </Link>

                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => onEditItem(item)}
                            title="Editar capa e informações"
                            className="p-1.5 rounded-lg text-outline hover:text-fuchsia-300 hover:bg-surface-container-high transition-colors"
                          >
                            <span className="material-symbols-outlined text-[17px]">
                              {thumb ? 'edit' : 'add_photo_alternate'}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onSyncItem(item)}
                            disabled={isSyncing}
                            title="Sincronizar com o Google Drive"
                            className="p-1.5 rounded-lg text-outline hover:text-secondary hover:bg-surface-container-high transition-colors disabled:opacity-50"
                          >
                            <span
                              className={`material-symbols-outlined text-[17px] ${
                                isSyncing ? 'animate-spin text-secondary' : ''
                              }`}
                            >
                              sync
                            </span>
                          </button>
                        </div>
                      </div>

                      {item.instructorName && (
                        <p className="text-[11px] text-outline mt-1 font-mono truncate">
                          {item.instructorName}
                        </p>
                      )}

                      <div className="flex items-center flex-wrap gap-2.5 mt-2.5 text-[11px] text-on-surface-variant font-mono">
                        {isMovie ? (
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px] text-outline">
                              schedule
                            </span>
                            {item.totalDurationSeconds > 0
                              ? formatWatchTime(item.totalDurationSeconds)
                              : 'Filme único'}
                          </span>
                        ) : (
                          <>
                            <span className="flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px] text-outline">
                                video_library
                              </span>
                              {item.modulesCount}{' '}
                              {item.modulesCount === 1 ? 'temporada' : 'temporadas'}
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px] text-outline">
                                smart_display
                              </span>
                              {item.lessonsCount}{' '}
                              {item.lessonsCount === 1 ? 'episódio' : 'episódios'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="p-4 pt-3">
                    <Link
                      href={
                        item.lastLessonId
                          ? `/courses/${item.id}?lesson=${item.lastLessonId}`
                          : `/courses/${item.id}`
                      }
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-surface-container-high hover:bg-gradient-to-r hover:from-fuchsia-600 hover:to-rose-600 hover:text-white text-on-surface text-xs font-semibold transition-all"
                    >
                      <span
                        className="material-symbols-outlined text-[18px]"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        play_arrow
                      </span>
                      <span>{watchPct > 0 ? 'Continuar' : 'Assistir'}</span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
