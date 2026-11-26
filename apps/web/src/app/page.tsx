'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  AuthConfigStatus,
  CourseSummary,
  DashboardOverview,
  ImportDriveFolderResult,
  ImportRootFolderResult,
} from '@devcore/shared';
import {
  ApiError,
  getAuthConfig,
  getDashboard,
  getGoogleAuthUrl,
  getPickerToken,
  importDriveFolder,
  importPickedDriveFiles,
  logout,
  resolveThumbnailUrl,
  syncDriveCourse,
} from '../lib/api';
import { openDriveFilesPicker, openDriveFolderPicker } from '../lib/google-picker';
import { DriveFolderBrowserModal } from '../components/DriveFolderBrowserModal';
import { DriveStreamingBrowserModal } from '../components/DriveStreamingBrowserModal';
import { StreamingDashboardView } from '../components/StreamingDashboardView';
import { YouTubeImportModal } from '../components/YouTubeImportModal';
import { CourseEditModal } from '../components/CourseEditModal';
import {
  formatWatchTime,
  getFirstName,
  getFormattedDatePtBr,
  getGreetingPtBr,
  getInitials,
} from '../lib/format';

export default function DashboardPage() {
  const [authConfig, setAuthConfig] = useState<AuthConfigStatus | null>(null);
  const [dashboard, setDashboard] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthenticated, setUnauthenticated] = useState(false);

  const [platformMode, setPlatformMode] = useState<'courses' | 'streaming'>('courses');
  const [searchQuery, setSearchQuery] = useState('');
  const [importing, setImporting] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [streamingBrowserOpen, setStreamingBrowserOpen] = useState(false);
  const [ytModalOpen, setYtModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<CourseSummary | null>(null);
  const [syncingCourseId, setSyncingCourseId] = useState<string | null>(null);
  const [showManualImport, setShowManualImport] = useState(false);
  const [manualFolderInput, setManualFolderInput] = useState('');
  const [banner, setBanner] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const [cfg, dash] = await Promise.all([
        getAuthConfig().catch(() => null),
        getDashboard().catch((err) => {
          if (err instanceof ApiError && err.status === 401) {
            return null;
          }
          throw err;
        }),
      ]);

      setAuthConfig(cfg);
      if (!dash) {
        setUnauthenticated(true);
        setDashboard(null);
      } else {
        setUnauthenticated(false);
        setDashboard(dash);
      }
    } catch (err) {
      if (!silent) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Não foi possível conectar à API do DevCore (porta 4000).';
        setBanner({ type: 'error', text: msg });
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  const switchPlatformMode = (next: 'courses' | 'streaming') => {
    setPlatformMode(next);
    setSearchQuery('');
    try {
      window.localStorage.setItem('devcore_platform_mode', next);
      const url = next === 'streaming' ? '/?mode=streaming' : '/';
      window.history.replaceState(null, '', url);
    } catch {
      // ignora
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get('mode');
    if (modeParam === 'streaming' || modeParam === 'courses') {
      setPlatformMode(modeParam);
      try {
        window.localStorage.setItem('devcore_platform_mode', modeParam);
      } catch {
        // ignora
      }
    } else {
      try {
        const savedMode = window.localStorage.getItem('devcore_platform_mode');
        if (savedMode === 'streaming') {
          setPlatformMode('streaming');
        }
      } catch {
        // ignora
      }
    }

    const authError = params.get('auth_error');
    const driveConnected = params.get('drive_connected');
    if (authError) {
      setBanner({ type: 'error', text: authError });
      window.history.replaceState({}, '', '/');
    } else if (driveConnected === '1') {
      setBanner({
        type: 'success',
        text: 'Google Drive conectado com sucesso! Agora selecione a pasta do seu curso para importar.',
      });
      window.history.replaceState({}, '', '/');
    }

    loadData();

    // Sincroniza automaticamente ao voltar para a aba ou focar a janela (celular <-> PC)
    let lastRefresh = 0;
    const triggerSilentRefresh = () => {
      const now = Date.now();
      if (now - lastRefresh < 3000) return;
      lastRefresh = now;
      loadData(true);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        triggerSilentRefresh();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', triggerSilentRefresh);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', triggerSilentRefresh);
    };
  }, [loadData]);

  const handleCourseImported = async (result: ImportDriveFolderResult) => {
    if (result.warning) {
      setBanner({ type: 'warning', text: result.warning });
    } else {
      setBanner({
        type: 'success',
        text: `Curso "${result.title}" carregado: ${result.modulesCount} módulo(s), ${result.lessonsCount} aula(s) e ${result.documentsCount} material(is).`,
      });
    }
    await loadData();
  };

  const handleRootImported = async (result: ImportRootFolderResult) => {
    setBanner({
      type: 'success',
      text: `Pasta "${result.rootFolderName}" importada: ${result.coursesImported} curso(s), ${result.totalModules} módulo(s) e ${result.totalLessons} aula(s) carregados!`,
    });
    await loadData();
  };

  const isDriveFileScope = Boolean(
    authConfig?.driveScope?.includes('drive.file') &&
      !authConfig?.driveScope?.includes('drive.readonly'),
  );

  const handleOpenPickedFilesImport = async (mode: 'course' | 'auto') => {
    setBanner(null);
    setImporting(true);
    try {
      const tokenInfo = await getPickerToken();
      const title =
        mode === 'auto'
          ? 'Escolha 1 vídeo (Filme) ou selecione episódios (Série)'
          : 'Selecione os vídeos e materiais do curso (Ctrl+A para vários)';
      const picked = await openDriveFilesPicker(tokenInfo, 'root', title);
      if (picked.length === 0) {
        setImporting(false);
        return;
      }

      const result = await importPickedDriveFiles({
        contentType: mode,
        files: picked,
      });

      if (mode === 'auto') {
        await handleStreamingItemImported(result);
      } else {
        await handleCourseImported(result);
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Erro ao importar arquivos selecionados do Google Drive.';
      setBanner({ type: 'error', text: msg });
    } finally {
      setImporting(false);
    }
  };

  const handleOpenFolderPicker = async () => {
    setBanner(null);
    setImporting(true);
    try {
      const tokenInfo = await getPickerToken();
      const picked = await openDriveFolderPicker(tokenInfo);
      if (!picked) {
        setImporting(false);
        return;
      }

      const result = await importDriveFolder({
        folderId: picked.id,
        folderName: picked.name,
      });

      if (result.warning) {
        setBanner({ type: 'warning', text: result.warning });
      } else {
        setBanner({
          type: 'success',
          text: `Curso "${result.title}" carregado: ${result.modulesCount} módulo(s), ${result.lessonsCount} aula(s) e ${result.documentsCount} material(is).`,
        });
      }
      await loadData();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Erro ao importar pasta do Google Drive.';
      setBanner({ type: 'error', text: msg });
    } finally {
      setImporting(false);
    }
  };

  const handleManualFolderImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualFolderInput.trim()) return;
    setBanner(null);
    setImporting(true);
    try {
      const result = await importDriveFolder({ folderId: manualFolderInput.trim() });
      setManualFolderInput('');
      setShowManualImport(false);
      if (result.warning) {
        setBanner({ type: 'warning', text: result.warning });
      } else {
        setBanner({
          type: 'success',
          text: `Curso "${result.title}" importado com ${result.modulesCount} módulo(s) e ${result.lessonsCount} aula(s).`,
        });
      }
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao importar pasta pelo link/ID.';
      setBanner({ type: 'error', text: msg });
    } finally {
      setImporting(false);
    }
  };

  const handleSyncCourse = async (course: CourseSummary) => {
    setBanner(null);
    setSyncingCourseId(course.id);
    try {
      const result = await syncDriveCourse(course.id);
      if (result.warning) {
        setBanner({ type: 'warning', text: result.warning });
      } else {
        setBanner({
          type: 'success',
          text: `"${result.title}" sincronizado (${result.modulesCount} módulos, ${result.lessonsCount} aulas).`,
        });
      }
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao sincronizar curso.';
      setBanner({ type: 'error', text: msg });
    } finally {
      setSyncingCourseId(null);
    }
  };

  const handleStreamingItemImported = async (result: ImportDriveFolderResult) => {
    const label = result.contentType === 'series' ? 'Série' : 'Filme';
    setBanner({
      type: result.warning ? 'warning' : 'success',
      text:
        result.warning ||
        (result.contentType === 'series'
          ? `${label} "${result.title}" adicionada com ${result.modulesCount} temporada(s) e ${result.lessonsCount} episódio(s)!`
          : `${label} "${result.title}" adicionado ao seu catálogo de Streaming!`),
    });
    await loadData();
  };

  const handleStreamingRootImported = async (result: ImportRootFolderResult) => {
    setBanner({
      type: 'success',
      text: `Pasta "${result.rootFolderName}" importada: ${result.coursesImported} título(s) adicionados ao Streaming!`,
    });
    await loadData();
  };

  const handleLogout = async () => {
    await logout().catch(() => undefined);
    setDashboard(null);
    setUnauthenticated(true);
  };

  const courseItems = useMemo(
    () => (dashboard ? dashboard.courses.filter((c) => (c.contentType || 'course') === 'course') : []),
    [dashboard],
  );

  const streamingItems = useMemo(
    () => (dashboard ? dashboard.courses.filter((c) => c.contentType === 'movie' || c.contentType === 'series') : []),
    [dashboard],
  );

  const filteredCourses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return courseItems;
    return courseItems.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.instructorName || '').toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q),
    );
  }, [courseItems, searchQuery]);

  const greetingDate = useMemo(() => getFormattedDatePtBr(), []);
  const greetingText = useMemo(() => getGreetingPtBr(), []);

  return (
    <div className="min-h-screen flex flex-col bg-surface font-sans overflow-x-hidden">
      {/* Header Fixo */}
      <header className="fixed top-0 inset-x-0 z-50 bg-surface/85 backdrop-blur-xl border-b border-outline-variant/20 shadow-lg">
        <div className="h-14 sm:h-16 w-full max-w-[1600px] mx-auto px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2.5 sm:gap-5 min-w-0">
            <Link href="/" className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <span
                className={`material-symbols-outlined text-[24px] sm:text-[28px] transition-colors ${
                  dashboard && platformMode === 'streaming' ? 'text-fuchsia-400' : 'text-primary'
                }`}
              >
                {dashboard && platformMode === 'streaming' ? 'movie' : 'terminal'}
              </span>
              <span className="text-base sm:text-xl font-bold tracking-tight text-on-surface">
                DevCore
              </span>
            </Link>

            {dashboard && (
              <div
                role="tablist"
                aria-label="Alternar modo da plataforma"
                className="flex items-center p-0.5 sm:p-1 rounded-xl bg-surface-container-low border border-outline-variant/25"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={platformMode === 'courses'}
                  onClick={() => switchPlatformMode('courses')}
                  className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all ${
                    platformMode === 'courses'
                      ? 'bg-primary-container text-on-primary-container shadow'
                      : 'text-outline hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                    school
                  </span>
                  <span>Cursos</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={platformMode === 'streaming'}
                  onClick={() => switchPlatformMode('streaming')}
                  className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all ${
                    platformMode === 'streaming'
                      ? 'bg-gradient-to-r from-fuchsia-600 to-rose-600 text-white shadow'
                      : 'text-outline hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                    live_tv
                  </span>
                  <span>Streaming</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {dashboard && (
              <div className="relative hidden sm:flex items-center bg-surface-container-low px-3 py-1.5 rounded-lg w-48 md:w-64 border border-outline-variant/30 text-outline focus-within:border-primary/60">
                <span className="material-symbols-outlined text-[18px] mr-2">search</span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={
                      platformMode === 'streaming' ? 'Filtrar filmes e séries...' : 'Filtrar cursos...'
                    }
                    className="bg-transparent text-xs text-on-surface placeholder:text-outline focus:outline-none w-full"
                  />
              </div>
            )}

            {dashboard ? (
              <div className="flex items-center gap-1.5 sm:gap-2.5">
                {/* Frequência de estudos (Streak) no Navbar */}
                <div
                  title={`Frequência de estudos: ${dashboard.stats.streakDays} ${
                    dashboard.stats.streakDays === 1 ? 'dia seguido' : 'dias seguidos'
                  }`}
                  className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-full bg-[#182334]/90 border border-slate-700/60 text-[11px] font-medium text-white shrink-0"
                >
                  <span className="text-[13px] leading-none select-none">🔥</span>
                  <span className="sm:hidden font-mono font-bold">
                    {dashboard.stats.streakDays}d
                  </span>
                  <span className="hidden sm:inline tracking-tight">
                    {dashboard.stats.streakDays}{' '}
                    {dashboard.stats.streakDays === 1 ? 'dia seguido' : 'dias seguidos'}
                  </span>
                </div>

                <div
                  className={`hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                    dashboard.drive.connected
                      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      dashboard.drive.connected ? 'bg-emerald-400' : 'bg-amber-400'
                    }`}
                  />
                  <span>{dashboard.drive.connected ? 'Drive Conectado' : 'Drive Desconectado'}</span>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2 pl-2 border-l border-outline-variant/30">
                  {dashboard.user.avatarUrl ? (
                    <img
                      src={dashboard.user.avatarUrl}
                      alt={dashboard.user.fullName}
                      className="w-7 h-7 sm:w-8 sm:h-8 rounded-full ring-1 ring-primary/40 object-cover"
                    />
                  ) : (
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-primary/20 ring-1 ring-primary/40 flex items-center justify-center text-primary font-bold text-xs">
                      {getInitials(dashboard.user.fullName)}
                    </div>
                  )}
                  <div className="hidden lg:flex flex-col text-left">
                    <span className="text-xs font-semibold text-on-surface">
                      {dashboard.user.fullName}
                    </span>
                    <span className="text-[10px] text-outline">{dashboard.user.email}</span>
                  </div>
                  <button
                    onClick={handleLogout}
                    title="Sair"
                    className="p-1.5 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">logout</span>
                  </button>
                </div>
              </div>
            ) : (
              <a
                href={getGoogleAuthUrl()}
                className="flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-semibold text-xs transition-all shadow-md"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.56-5.15 3.56-8.65Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.1A12 12 0 0 0 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.29A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.29v-3.1H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l4-3.1Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.76c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4 3.1c.95-2.84 3.6-4.95 6.72-4.95Z"
                  />
                </svg>
                <span className="hidden sm:inline">Entrar com Google</span>
                <span className="sm:hidden">Entrar</span>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="w-full max-w-[1600px] mx-auto px-3 sm:px-6 pt-16 sm:pt-20 pb-12 sm:pb-16 flex-1">
        {/* Alertas / Feedback */}
        {banner && (
          <div
            className={`mt-4 mb-4 p-4 rounded-xl border flex items-start justify-between gap-4 text-sm ${
              banner.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : banner.type === 'warning'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                  : 'bg-error/10 border-error/30 text-error'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <span className="material-symbols-outlined text-[20px] shrink-0 mt-0.5">
                {banner.type === 'success'
                  ? 'check_circle'
                  : banner.type === 'warning'
                    ? 'warning'
                    : 'error'}
              </span>
              <p className="leading-relaxed">{banner.text}</p>
            </div>
            <button
              onClick={() => setBanner(null)}
              className="text-current opacity-70 hover:opacity-100"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        )}

        {/* Loading Inicial */}
        {loading && !dashboard && !unauthenticated && (
          <div className="mt-16 flex flex-col items-center justify-center gap-3 text-outline">
            <span className="material-symbols-outlined text-4xl text-primary animate-spin">
              progress_activity
            </span>
            <p className="text-sm">Carregando sua biblioteca DevCore...</p>
          </div>
        )}

        {/* Estado Não Autenticado — Landing Page de Entrada */}
        {!loading && unauthenticated && (
          <section className="mt-4 sm:mt-8 space-y-6 sm:space-y-8">
            <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-[#070d18] via-[#0d182b] to-[#08101d] border border-outline-variant/25 shadow-2xl p-6 sm:p-10 lg:p-14">
              {/* Brilhos ambientais sutis */}
              <div
                className="pointer-events-none absolute -top-24 -left-24 w-72 h-72 rounded-full bg-primary/15 blur-3xl"
                aria-hidden="true"
              />
              <div
                className="pointer-events-none absolute -bottom-24 -right-24 w-80 h-80 rounded-full bg-secondary/10 blur-3xl"
                aria-hidden="true"
              />

              <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
                {/* Coluna Esquerda: Headline + Entrada Exclusiva Google */}
                <div className="lg:col-span-7">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/10 border border-secondary/30 text-secondary text-[11px] font-mono font-semibold uppercase tracking-wider mb-5">
                    <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                    <span>Entrada exclusiva pela sua conta Google</span>
                  </div>

                  <h1 className="text-3xl sm:text-5xl lg:text-[54px] font-extrabold text-white tracking-tight leading-[1.08]">
                    Uma plataforma.{' '}
                    <span className="block bg-gradient-to-r from-primary via-secondary to-tertiary bg-clip-text text-transparent">
                      Seus conteúdos.
                    </span>
                  </h1>

                  <p className="text-slate-300 mt-5 text-sm sm:text-base lg:text-[17px] leading-relaxed max-w-2xl">
                    Transforme suas pastas do <strong className="text-white">Google Drive</strong> e
                    playlists do <strong className="text-white">YouTube</strong> em uma plataforma
                    que se adapta ao que você quer ver — modo <strong className="text-primary">Cursos</strong>{' '}
                    (com Tutor IA Gemini, anotações e leitor PDF/Word) e modo{' '}
                    <strong className="text-fuchsia-300">Streaming</strong> (para seus Filmes e
                    Séries por temporadas).
                  </p>

                  {/* CTA Principal — Login Exclusivo Google */}
                  <div className="mt-7 sm:mt-8 flex flex-col sm:flex-row sm:items-center gap-3.5">
                    <a
                      href={getGoogleAuthUrl()}
                      className="inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm transition-all shadow-xl hover:scale-[1.01]"
                    >
                      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          fill="#4285F4"
                          d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.56-5.15 3.56-8.65Z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.1A12 12 0 0 0 12 24Z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.28 14.29A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.29v-3.1H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l4-3.1Z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 4.76c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4 3.1c.95-2.84 3.6-4.95 6.72-4.95Z"
                        />
                      </svg>
                      <span>Continuar com sua conta Google</span>
                    </a>

                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="material-symbols-outlined text-emerald-400 text-[18px] shrink-0">
                        verified_user
                      </span>
                      <span>Sem senhas extras · Seu acervo fica 100% privado na sua conta</span>
                    </div>
                  </div>

                  {/* Selos rápidos de recursos */}
                  <div className="mt-6 flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-300">
                    <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10">
                      Google Drive &amp; YouTube
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10">
                      Sincronizado PC ↔ Celular
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10">
                      Tutor IA Gemini
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10">
                      Leitor PDF · Word · Imagem
                    </span>
                  </div>

                  {authConfig && (!authConfig.googleConfigured || !authConfig.pickerConfigured) && (
                    <div className="mt-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-100 text-xs space-y-1.5">
                      <div className="flex items-center gap-2 font-semibold text-amber-300">
                        <span className="material-symbols-outlined text-[18px]">settings</span>
                        <span>Configuração pendente no arquivo .env</span>
                      </div>
                      <p className="text-amber-200/90 leading-relaxed">
                        Preencha{' '}
                        {!authConfig.googleConfigured && (
                          <code className="px-1.5 py-0.5 rounded bg-black/30 font-mono">
                            GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
                          </code>
                        )}
                        {!authConfig.googleConfigured && !authConfig.pickerConfigured && ' e '}
                        {!authConfig.pickerConfigured && (
                          <code className="px-1.5 py-0.5 rounded bg-black/30 font-mono">
                            GOOGLE_PICKER_API_KEY
                          </code>
                        )}{' '}
                        no servidor para ativar a autenticação Google.
                      </p>
                    </div>
                  )}
                </div>

                {/* Coluna Direita: Cartão Visual "Como Funciona" */}
                <div className="lg:col-span-5">
                  <div className="rounded-2xl bg-[#0b1220]/90 border border-outline-variant/30 p-5 sm:p-6 shadow-2xl space-y-5">
                    <div className="flex items-center justify-between gap-2 pb-4 border-b border-outline-variant/20">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-400/80" />
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                      </div>
                      <span className="text-[11px] font-mono text-secondary">
                        SEU AMBIENTE DE ESTUDOS
                      </span>
                    </div>

                    <div className="space-y-3.5">
                      <div className="flex items-start gap-3 p-3 rounded-xl bg-surface-container/60 border border-outline-variant/20">
                        <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0 font-mono text-xs font-bold">
                          01
                        </div>
                        <div>
                          <h3 className="text-xs sm:text-sm font-bold text-white">
                            Entre com sua conta Google
                          </h3>
                          <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 leading-relaxed">
                            Acesso exclusivo e individual: cada usuário enxerga somente seus
                            próprios cursos, progresso e anotações.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 p-3 rounded-xl bg-surface-container/60 border border-outline-variant/20">
                        <div className="w-8 h-8 rounded-lg bg-secondary/15 text-secondary flex items-center justify-center shrink-0 font-mono text-xs font-bold">
                          02
                        </div>
                        <div>
                          <h3 className="text-xs sm:text-sm font-bold text-white">
                            Conecte pastas do Drive ou playlists
                          </h3>
                          <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 leading-relaxed">
                            Suas pastas viram cursos e módulos automaticamente, com suporte a
                            vídeos, PDFs, Word, imagens e playlists do YouTube.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 p-3 rounded-xl bg-surface-container/60 border border-outline-variant/20">
                        <div className="w-8 h-8 rounded-lg bg-tertiary/15 text-tertiary flex items-center justify-center shrink-0 font-mono text-xs font-bold">
                          03
                        </div>
                        <div>
                          <h3 className="text-xs sm:text-sm font-bold text-white">
                            Estude em qualquer dispositivo
                          </h3>
                          <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 leading-relaxed">
                            Comece no computador e continue do celular exatamente no segundo em
                            que parou, com apoio do Tutor IA Gemini.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 flex items-center justify-between text-[11px] text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-primary text-[16px]">
                          lock
                        </span>
                        <span>Acesso somente leitura ao Drive</span>
                      </span>
                      <span className="font-mono text-emerald-300">100% seu</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 4 Pilares da Plataforma */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-surface-container-low border border-outline-variant/20">
                <span className="material-symbols-outlined text-primary text-[26px] mb-2.5">
                  cloud_done
                </span>
                <h3 className="text-sm font-bold text-white">Seus arquivos, seu controle</h3>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  Nada é duplicado ou compartilhado. Os vídeos e materiais permanecem seguros no
                  seu próprio Google Drive.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-surface-container-low border border-outline-variant/20">
                <span className="material-symbols-outlined text-secondary text-[26px] mb-2.5">
                  smart_display
                </span>
                <h3 className="text-sm font-bold text-white">Player dedicado e fluido</h3>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  Troca de aulas sem recarregar a página, velocidade ajustável, modo teatro,
                  autoplay e player próprio até no YouTube.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-surface-container-low border border-outline-variant/20">
                <span className="material-symbols-outlined text-emerald-400 text-[26px] mb-2.5">
                  menu_book
                </span>
                <h3 className="text-sm font-bold text-white">Materiais ao lado da aula</h3>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  Abra PDFs, documentos Word e imagens diretamente na plataforma e salve
                  anotações ancoradas no minuto exato do vídeo.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-surface-container-low border border-outline-variant/20">
                <span className="material-symbols-outlined text-tertiary text-[26px] mb-2.5">
                  auto_awesome
                </span>
                <h3 className="text-sm font-bold text-white">Tutor IA que entende o curso</h3>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  Converse com o Gemini com contexto da ementa, da aula atual, das suas notas e
                  dos materiais de apoio do curso.
                </p>
              </div>
            </div>

            {/* Rodapé Institucional (requisito Google OAuth Produção) */}
            <footer className="pt-4 border-t border-outline-variant/20 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-outline">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[16px]">terminal</span>
                <span>DevCore · Uma plataforma. Seus conteúdos.</span>
              </div>
              <div className="flex items-center gap-4">
                <Link href="/privacidade" className="hover:text-on-surface transition-colors">
                  Política de Privacidade
                </Link>
                <Link href="/termos" className="hover:text-on-surface transition-colors">
                  Termos de Uso
                </Link>
              </div>
            </footer>
          </section>
        )}

        {/* Dashboard Autenticado — Molda-se entre Cursos e Streaming */}
        {dashboard && platformMode === 'streaming' && (
          <StreamingDashboardView
            items={streamingItems}
            continueWatching={dashboard.streamingContinueWatching ?? null}
            driveConnected={dashboard.drive.connected}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            syncingId={syncingCourseId}
            onOpenStreamingBrowser={() => {
              if (isDriveFileScope && authConfig?.pickerConfigured) {
                handleOpenPickedFilesImport('auto');
              } else {
                setStreamingBrowserOpen(true);
              }
            }}
            onSyncItem={handleSyncCourse}
            onEditItem={(item) => setEditingCourse(item)}
          />
        )}

        {dashboard && platformMode === 'courses' && (
          <>
            {/* Hero Banner + 4 Stat Cards Reais */}
            <section className="w-full mt-4 mb-8">
              <div className="relative w-full rounded-2xl overflow-hidden bg-gradient-to-br from-[#070d18] via-[#0c1626] to-[#0a1220] border border-outline-variant/20 shadow-2xl">
                <div
                  className="absolute inset-0 select-none pointer-events-none overflow-hidden font-mono text-xs"
                  aria-hidden="true"
                >
                  <span className="absolute opacity-[0.09] text-sky-400 top-[8%] left-[48%]">
                    drive.files.list()
                  </span>
                  <span className="absolute opacity-[0.08] text-secondary top-[22%] left-[52%]">
                    =&gt;
                  </span>
                  <span className="absolute opacity-[0.08] text-primary top-[38%] left-[45%] text-sm">
                    &lt;video /&gt;
                  </span>
                  <span className="absolute opacity-[0.07] text-secondary top-[52%] left-[52%]">
                    Range: bytes=0-
                  </span>
                </div>

                {/* Cabeçalho do Hero */}
                <div className="relative z-10 px-4 pt-5 pb-4 sm:px-8 sm:pt-8 sm:pb-6 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[10px] sm:text-[11px] font-mono text-slate-400 uppercase tracking-widest mb-1 font-semibold">
                      {greetingDate}
                    </div>
                    <h1 className="text-2xl sm:text-4xl text-white font-extrabold tracking-tight">
                      {greetingText}, {getFirstName(dashboard.user.fullName)}.
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-300 mt-1 font-normal">
                      {dashboard.courses.length > 0
                        ? 'Continue de onde parou ou importe novos cursos do Drive e YouTube.'
                        : 'Importe sua primeira pasta de curso do Drive ou playlist do YouTube para começar.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 sm:gap-2.5 w-full lg:w-auto flex-wrap">
                    <button
                      onClick={() => setYtModalOpen(true)}
                      className="flex-1 sm:flex-none justify-center flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/35 font-semibold text-xs sm:text-sm transition-all"
                    >
                      <span className="material-symbols-outlined text-[18px]">smart_display</span>
                      <span>YouTube</span>
                    </button>

                    {dashboard.drive.connected ? (
                      <button
                        onClick={() => {
                          if (isDriveFileScope && authConfig?.pickerConfigured) {
                            handleOpenPickedFilesImport('course');
                          } else {
                            setBrowserOpen(true);
                          }
                        }}
                        disabled={importing}
                        className="flex-1 sm:flex-none justify-center flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl bg-primary-container hover:bg-secondary-container text-on-primary-container font-bold text-xs sm:text-sm transition-all shadow-md disabled:opacity-60"
                      >
                        <span
                          className={`material-symbols-outlined text-[18px] ${
                            importing ? 'animate-spin' : ''
                          }`}
                        >
                          {importing ? 'progress_activity' : 'add_to_drive'}
                        </span>
                        <span>
                          {importing
                            ? 'Importando...'
                            : isDriveFileScope
                              ? 'Importar do Drive'
                              : 'Pastas do Drive'}
                        </span>
                      </button>
                    ) : (
                      <a
                        href={getGoogleAuthUrl()}
                        className="flex-1 sm:flex-none justify-center flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs sm:text-sm transition-all shadow-md"
                      >
                        <span className="material-symbols-outlined text-[18px]">cloud_sync</span>
                        <span>Reconectar Drive</span>
                      </a>
                    )}

                    {dashboard.drive.connected && !isDriveFileScope && (
                      <button
                        type="button"
                        onClick={() => setShowManualImport((v) => !v)}
                        title="Importar pasta colando link ou ID do Drive"
                        className={`p-2 rounded-xl border text-xs transition-colors ${
                          showManualImport
                            ? 'bg-primary/15 text-primary border-primary/40'
                            : 'bg-surface-container/80 hover:bg-surface-container-high border-outline-variant/30 text-on-surface-variant'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[18px]">link</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Grid dos 4 Stat Cards com Métricas Reais */}
                <div className="relative z-10 px-4 pb-5 sm:px-8 sm:pb-8 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  <div className="relative rounded-xl sm:rounded-2xl overflow-hidden p-3.5 sm:p-5 flex flex-col justify-between bg-[#82BAFA] shadow-md min-h-[90px] sm:min-h-[110px]">
                    <span className="material-symbols-outlined absolute -right-2 -bottom-2 text-[64px] sm:text-[88px] text-black/[0.08] select-none pointer-events-none">
                      checklist
                    </span>
                    <span className="text-[11px] sm:text-[13px] font-semibold text-[#1E293B]">
                      Em progresso
                    </span>
                    <span className="text-2xl sm:text-4xl font-extrabold leading-none text-[#0F172A] mt-2">
                      {dashboard.stats.coursesInProgress}
                    </span>
                  </div>

                  <div className="relative rounded-xl sm:rounded-2xl overflow-hidden p-3.5 sm:p-5 flex flex-col justify-between bg-[#B2E59C] shadow-md min-h-[90px] sm:min-h-[110px]">
                    <span className="material-symbols-outlined absolute -right-2 -bottom-2 text-[64px] sm:text-[88px] text-black/[0.08] select-none pointer-events-none">
                      emoji_events
                    </span>
                    <span className="text-[11px] sm:text-[13px] font-semibold text-[#1E293B]">
                      Concluídos
                    </span>
                    <span className="text-2xl sm:text-4xl font-extrabold leading-none text-[#0F172A] mt-2">
                      {dashboard.stats.coursesCompleted}
                    </span>
                  </div>

                  <div className="relative rounded-xl sm:rounded-2xl overflow-hidden p-3.5 sm:p-5 flex flex-col justify-between bg-[#FFBA7A] shadow-md min-h-[90px] sm:min-h-[110px]">
                    <span className="material-symbols-outlined absolute -right-2 -bottom-2 text-[64px] sm:text-[88px] text-black/[0.08] select-none pointer-events-none">
                      hourglass_empty
                    </span>
                    <span className="text-[11px] sm:text-[13px] font-semibold text-[#1E293B]">
                      Tempo assistido
                    </span>
                    <span className="text-xl sm:text-4xl font-extrabold leading-none text-[#0F172A] mt-2">
                      {formatWatchTime(dashboard.stats.totalWatchedSeconds)}
                    </span>
                  </div>

                  <div className="relative rounded-xl sm:rounded-2xl overflow-hidden p-3.5 sm:p-5 flex flex-col justify-between bg-[#CCA7F8] shadow-md min-h-[90px] sm:min-h-[110px]">
                    <span className="material-symbols-outlined absolute -right-2 -bottom-2 text-[64px] sm:text-[88px] text-black/[0.08] select-none pointer-events-none">
                      pie_chart
                    </span>
                    <span className="text-[11px] sm:text-[13px] font-semibold text-[#1E293B]">
                      Conclusão geral
                    </span>
                    <div className="flex items-center gap-2 sm:gap-3 mt-2">
                      <span className="text-2xl sm:text-4xl font-extrabold leading-none text-[#0F172A]">
                        {dashboard.stats.overallCompletionPercent}%
                      </span>
                      <div className="flex-1 max-w-[120px] h-2 sm:h-2.5 rounded-full bg-black/10 overflow-hidden relative">
                        <div
                          className="h-full bg-white/90 rounded-full transition-all duration-500"
                          style={{ width: `${dashboard.stats.overallCompletionPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Continuar Estudando (somente dados reais) */}
            {dashboard.continueWatching && (() => {
              const cw = dashboard.continueWatching;
              const cwCourse = dashboard.courses.find((c) => c.id === cw.courseId);
              const cwPercent =
                cwCourse?.progressPercent ??
                (cw.totalCourseSeconds > 0
                  ? Math.min(100, Math.round((cw.watchedCourseSeconds / cw.totalCourseSeconds) * 100))
                  : 0);
              return (
                <section className="w-full mb-6 sm:mb-8">
                  <div className="p-4 sm:p-6 bg-surface-container-low rounded-2xl border border-secondary/20 shadow-xl flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-4 sm:gap-6">
                    <div className="flex items-start gap-3.5 sm:gap-4 flex-1 min-w-0">
                      <div className="w-16 h-14 sm:w-20 sm:h-16 rounded-xl overflow-hidden bg-gradient-to-br from-primary-container/30 to-secondary/20 border border-outline-variant/25 flex items-center justify-center shrink-0">
                        {resolveThumbnailUrl(cwCourse?.thumbnailUrl) ? (
                          <img
                            src={resolveThumbnailUrl(cwCourse?.thumbnailUrl)!}
                            alt={cw.courseTitle}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="material-symbols-outlined text-primary text-[28px]">
                            play_lesson
                          </span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-[10px] sm:text-xs font-mono text-secondary font-semibold uppercase tracking-wider">
                            Continue de onde parou
                          </span>
                          {cw.totalCourseSeconds > 0 && (
                            <span className="hidden sm:inline text-[11px] font-mono text-outline">
                              · {formatWatchTime(cw.watchedCourseSeconds)} de{' '}
                              {formatWatchTime(cw.totalCourseSeconds)}
                            </span>
                          )}
                        </div>
                        <h2 className="text-base sm:text-2xl font-bold text-on-surface tracking-tight line-clamp-1">
                          {cw.courseTitle}
                        </h2>
                        <p className="text-xs sm:text-sm text-on-surface-variant mt-0.5 line-clamp-1">
                          <span className="text-secondary/90 font-medium">{cw.moduleTitle}:</span>{' '}
                          {cw.lessonTitle}
                        </p>
                        <div className="flex items-center gap-2.5 mt-2.5 max-w-md">
                          <div className="flex-1 h-1.5 rounded-full bg-surface-container-highest overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-primary-container to-secondary"
                              style={{ width: `${cwPercent}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-mono text-outline shrink-0">
                            {cwPercent}%
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 w-full lg:w-auto shrink-0">
                      <Link
                        href={`/courses/${cw.courseId}?lesson=${cw.lessonId}`}
                        className="flex-1 lg:flex-none justify-center flex items-center gap-2 px-5 py-2.5 sm:py-3 rounded-xl bg-primary-container hover:bg-secondary-container text-on-primary-container font-semibold text-xs sm:text-sm transition-all shadow-md"
                      >
                        <span
                          className="material-symbols-outlined text-[18px] sm:text-[20px]"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          play_arrow
                        </span>
                        <span>Continuar curso</span>
                      </Link>
                      <Link
                        href={`/courses/${cw.courseId}`}
                        className="px-3.5 py-2.5 sm:py-3 rounded-xl bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-on-surface-variant text-xs sm:text-sm font-medium transition-colors shrink-0"
                      >
                        Ver aulas
                      </Link>
                    </div>
                  </div>
                </section>
              );
            })()}

            {/* Busca Mobile */}
            <div className="sm:hidden mb-4">
              <div className="flex items-center bg-surface-container-low px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-outline focus-within:border-primary/60">
                <span className="material-symbols-outlined text-[18px] mr-2">search</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar cursos por título ou instrutor..."
                  className="bg-transparent text-xs text-on-surface placeholder:text-outline focus:outline-none w-full"
                />
              </div>
            </div>

            {/* Biblioteca de Cursos do Google Drive */}
            <section className="w-full">
              <div className="mb-5">
                <h2 className="text-xl font-bold text-on-surface tracking-tight">
                  Meus Cursos ({filteredCourses.length})
                </h2>
                <p className="text-xs text-outline mt-0.5">
                  Cursos sincronizados do Google Drive e playlists do YouTube em um só lugar.
                </p>
              </div>

              {/* Fallback opcional de importação por Link ou ID */}
              {showManualImport && (
                <form
                  onSubmit={handleManualFolderImport}
                  className="mb-6 p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center"
                >
                  <input
                    type="text"
                    value={manualFolderInput}
                    onChange={(e) => setManualFolderInput(e.target.value)}
                    placeholder="Cole o link da pasta do Drive (https://drive.google.com/drive/folders/...) ou o Folder ID"
                    className="flex-1 bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-3.5 py-2 text-xs text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    disabled={importing || !manualFolderInput.trim()}
                    className="px-4 py-2 rounded-lg bg-primary-container hover:bg-secondary-container text-on-primary-container font-semibold text-xs transition-colors disabled:opacity-50"
                  >
                    {importing ? 'Sincronizando...' : 'Importar Pasta'}
                  </button>
                </form>
              )}

              {/* Grid de Cursos ou Estado Vazio */}
              {filteredCourses.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-outline-variant/40 bg-surface-container-low/50 p-12 text-center flex flex-col items-center">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-4">
                    <span className="material-symbols-outlined text-[30px]">add_to_drive</span>
                  </div>
                  <h3 className="text-lg font-bold text-on-surface">
                    {searchQuery
                      ? 'Nenhum curso encontrado para este filtro'
                      : 'Nenhum curso importado ainda'}
                  </h3>
                  <p className="text-sm text-outline max-w-md mt-1.5">
                    {searchQuery
                      ? 'Tente buscar por outro termo ou limpe o campo de busca.'
                      : 'Clique no botão abaixo para escolher os vídeos e materiais do seu Google Drive.'}
                  </p>
                  {!searchQuery && dashboard.drive.connected && (
                    <button
                      onClick={() => {
                        if (isDriveFileScope && authConfig?.pickerConfigured) {
                          handleOpenPickedFilesImport('course');
                        } else {
                          setBrowserOpen(true);
                        }
                      }}
                      disabled={importing}
                      className="mt-6 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-container hover:bg-secondary-container text-on-primary-container font-semibold text-sm transition-all"
                    >
                      <span className="material-symbols-outlined text-[20px]">add_to_drive</span>
                      <span>
                        {importing ? 'Importando...' : 'Importar meu primeiro curso do Drive'}
                      </span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {filteredCourses.map((course) => {
                    const isSyncing = syncingCourseId === course.id;
                    const isYoutube =
                      course.sourceType === 'youtube' ||
                      Boolean(course.driveFolderId?.startsWith('yt:playlist:'));
                    const resolvedThumb = resolveThumbnailUrl(course.thumbnailUrl);
                    return (
                      <div
                        key={course.id}
                        className="group rounded-2xl bg-surface-container-low border border-outline-variant/25 hover:border-primary/40 transition-all overflow-hidden flex flex-col justify-between shadow-lg"
                      >
                        <div>
                          {resolvedThumb && (
                            <Link href={`/courses/${course.id}`} className="block relative h-36 w-full overflow-hidden bg-black">
                              <img
                                src={resolvedThumb}
                                alt={course.title}
                                className="w-full h-full object-cover opacity-85 group-hover:opacity-100 group-hover:scale-[1.03] transition-all duration-300"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-surface-container-low via-transparent to-transparent" />
                            </Link>
                          )}

                          <div className="p-5 pb-0">
                            <div className="flex items-start justify-between gap-3 mb-3">
                              {isYoutube ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/15 text-red-300 text-[11px] font-mono">
                                  <span className="material-symbols-outlined text-[14px]">
                                    smart_display
                                  </span>
                                  <span>YouTube</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/10 text-primary text-[11px] font-mono">
                                  <span className="material-symbols-outlined text-[14px]">
                                    folder
                                  </span>
                                  <span>Google Drive</span>
                                </span>
                              )}

                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setEditingCourse(course)}
                                  title="Editar curso e capa"
                                  className="p-1.5 rounded-lg text-outline hover:text-primary hover:bg-surface-container-high transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[18px]">
                                    {resolvedThumb ? 'edit' : 'add_photo_alternate'}
                                  </span>
                                </button>
                                <button
                                  onClick={() => handleSyncCourse(course)}
                                  disabled={isSyncing}
                                  title={
                                    isYoutube
                                      ? 'Sincronizar novos vídeos da playlist no YouTube'
                                      : 'Sincronizar alterações da pasta no Google Drive'
                                  }
                                  className="p-1.5 rounded-lg text-outline hover:text-secondary hover:bg-surface-container-high transition-colors disabled:opacity-50"
                                >
                                  <span
                                    className={`material-symbols-outlined text-[18px] ${
                                      isSyncing ? 'animate-spin text-secondary' : ''
                                    }`}
                                  >
                                    sync
                                  </span>
                                </button>
                              </div>
                            </div>

                            <Link href={`/courses/${course.id}`}>
                              <h3 className="text-lg font-bold text-on-surface group-hover:text-primary transition-colors line-clamp-2">
                                {course.title}
                              </h3>
                            </Link>

                            {course.instructorName && (
                              <p className="text-xs text-outline mt-1 font-mono">
                                {course.instructorName}
                              </p>
                            )}

                            <div className="flex items-center flex-wrap gap-3 mt-4 text-xs text-on-surface-variant font-mono">
                              <span className="flex items-center gap-1">
                                <span className="material-symbols-outlined text-[15px] text-outline">
                                  folder_copy
                                </span>
                                {course.modulesCount}{' '}
                                {course.modulesCount === 1 ? 'módulo' : 'módulos'}
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="material-symbols-outlined text-[15px] text-outline">
                                  play_lesson
                                </span>
                                {course.lessonsCount} {course.lessonsCount === 1 ? 'aula' : 'aulas'}
                              </span>
                              {course.totalDurationSeconds > 0 && (
                                <span className="flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[15px] text-outline">
                                    schedule
                                  </span>
                                  {formatWatchTime(course.totalDurationSeconds)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="p-5 mt-5 pt-4 border-t border-outline-variant/20">
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="text-outline">
                              {course.completedLessonsCount}/{course.lessonsCount} concluídas
                            </span>
                            <span className="font-mono font-semibold text-primary">
                              {course.progressPercent}%
                            </span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-surface-container-highest overflow-hidden mb-4">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-primary-container to-secondary transition-all duration-500"
                              style={{ width: `${course.progressPercent}%` }}
                            />
                          </div>

                          <Link
                            href={
                              course.lastLessonId
                                ? `/courses/${course.id}?lesson=${course.lastLessonId}`
                                : `/courses/${course.id}`
                            }
                            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-surface-container-high hover:bg-primary-container hover:text-on-primary-container text-on-surface text-xs font-semibold transition-all"
                          >
                            <span className="material-symbols-outlined text-[18px]">
                              play_arrow
                            </span>
                            <span>
                              {course.completedLessonsCount > 0 ? 'Continuar curso' : 'Abrir curso'}
                            </span>
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
        <DriveFolderBrowserModal
          open={browserOpen}
          onClose={() => setBrowserOpen(false)}
          onCourseImported={handleCourseImported}
          onRootImported={handleRootImported}
          onFallbackPicker={handleOpenFolderPicker}
        />

        <DriveStreamingBrowserModal
          open={streamingBrowserOpen}
          onClose={() => setStreamingBrowserOpen(false)}
          onItemImported={handleStreamingItemImported}
          onRootImported={handleStreamingRootImported}
        />

        <CourseEditModal
          course={editingCourse}
          onClose={() => setEditingCourse(null)}
          onSaved={(updated) => {
            setDashboard((prev) =>
              prev
                ? {
                    ...prev,
                    courses: prev.courses.map((c) => (c.id === updated.id ? updated : c)),
                  }
                : prev,
            );
          }}
        />

        <YouTubeImportModal
          open={ytModalOpen}
          onClose={() => setYtModalOpen(false)}
          onImported={handleCourseImported}
        />
      </main>
    </div>
  );
}
