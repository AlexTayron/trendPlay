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
  logout,
  syncDriveCourse,
} from '../lib/api';
import { openDriveFolderPicker } from '../lib/google-picker';
import { DriveFolderBrowserModal } from '../components/DriveFolderBrowserModal';
import { YouTubeImportModal } from '../components/YouTubeImportModal';
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

  const [searchQuery, setSearchQuery] = useState('');
  const [importing, setImporting] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [ytModalOpen, setYtModalOpen] = useState(false);
  const [syncingCourseId, setSyncingCourseId] = useState<string | null>(null);
  const [showManualImport, setShowManualImport] = useState(false);
  const [manualFolderInput, setManualFolderInput] = useState('');
  const [banner, setBanner] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
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
      const msg =
        err instanceof Error
          ? err.message
          : 'Não foi possível conectar à API do DevCore (porta 4000).';
      setBanner({ type: 'error', text: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
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

  const handleLogout = async () => {
    await logout().catch(() => undefined);
    setDashboard(null);
    setUnauthenticated(true);
  };

  const filteredCourses = useMemo(() => {
    if (!dashboard) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return dashboard.courses;
    return dashboard.courses.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.instructorName || '').toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q),
    );
  }, [dashboard, searchQuery]);

  const greetingDate = useMemo(() => getFormattedDatePtBr(), []);
  const greetingText = useMemo(() => getGreetingPtBr(), []);

  return (
    <div className="min-h-screen flex flex-col bg-surface font-sans overflow-x-hidden">
      {/* Header Fixo */}
      <header className="fixed top-0 inset-x-0 z-50 bg-surface/85 backdrop-blur-xl border-b border-outline-variant/20 shadow-lg">
        <div className="h-14 sm:h-16 w-full max-w-[1600px] mx-auto px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-3 sm:gap-6 min-w-0">
            <Link href="/" className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <span className="material-symbols-outlined text-primary text-[24px] sm:text-[28px]">terminal</span>
              <span className="text-lg sm:text-xl font-bold tracking-tight text-on-surface">DevCore</span>
            </Link>
            <nav className="hidden md:flex items-center gap-4 h-16">
              <Link
                href="/"
                className="h-full flex items-center px-2 text-on-surface font-medium border-b-2 border-primary"
              >
                Biblioteca
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {dashboard && (
              <div className="relative hidden sm:flex items-center bg-surface-container-low px-3 py-1.5 rounded-lg w-48 md:w-64 border border-outline-variant/30 text-outline focus-within:border-primary/60">
                <span className="material-symbols-outlined text-[18px] mr-2">search</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filtrar cursos..."
                  className="bg-transparent text-xs text-on-surface placeholder:text-outline focus:outline-none w-full"
                />
              </div>
            )}

            {dashboard ? (
              <div className="flex items-center gap-2 sm:gap-3">
                <div
                  className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
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
                className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg bg-primary-container hover:bg-secondary-container text-on-primary-container font-semibold text-xs transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">cloud_sync</span>
                <span className="hidden sm:inline">Conectar Google Drive</span>
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

        {/* Estado Não Autenticado */}
        {!loading && unauthenticated && (
          <section className="mt-4 sm:mt-8">
            <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-[#070d18] via-[#0c1626] to-[#0a1220] border border-outline-variant/20 shadow-2xl p-5 sm:p-8 md:p-12">
              <div className="max-w-3xl">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/15 text-secondary text-[11px] sm:text-xs font-mono font-semibold uppercase tracking-wider mb-4">
                  <span className="material-symbols-outlined text-[16px]">folder_open</span>
                  ACERVO PESSOAL · GOOGLE DRIVE &amp; YOUTUBE
                </span>
                <h1 className="text-2xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight">
                  Seus cursos do Google Drive e YouTube em uma plataforma de estudo.
                </h1>
                <p className="text-slate-300 mt-4 text-base leading-relaxed">
                  Conecte sua conta Google, selecione as pastas dos seus cursos usando o Google
                  Picker e estude com player HTML5 próprio, controle de velocidade, progresso
                  automático e anotações vinculadas ao minuto exato do vídeo.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <a
                    href={getGoogleAuthUrl()}
                    className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-primary-container hover:bg-secondary-container text-on-primary-container font-bold text-sm transition-all shadow-lg"
                  >
                    <span className="material-symbols-outlined text-[20px]">login</span>
                    <span>Entrar e Conectar Google Drive</span>
                  </a>
                </div>

                {authConfig && (!authConfig.googleConfigured || !authConfig.pickerConfigured) && (
                  <div className="mt-8 p-5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-100 text-xs space-y-2">
                    <div className="flex items-center gap-2 font-semibold text-amber-300">
                      <span className="material-symbols-outlined text-[18px]">settings</span>
                      <span>Configuração pendente no arquivo .env</span>
                    </div>
                    <p className="text-amber-200/90 leading-relaxed">
                      Para ativar a conexão com o Google Drive, preencha{' '}
                      {!authConfig.googleConfigured && (
                        <code className="px-1.5 py-0.5 rounded bg-black/30 font-mono">
                          GOOGLE_CLIENT_ID
                        </code>
                      )}
                      {!authConfig.googleConfigured && ' e '}
                      {!authConfig.googleConfigured && (
                        <code className="px-1.5 py-0.5 rounded bg-black/30 font-mono">
                          GOOGLE_CLIENT_SECRET
                        </code>
                      )}
                      {!authConfig.googleConfigured && !authConfig.pickerConfigured && ' além de '}
                      {!authConfig.pickerConfigured && (
                        <code className="px-1.5 py-0.5 rounded bg-black/30 font-mono">
                          GOOGLE_PICKER_API_KEY
                        </code>
                      )}{' '}
                      no arquivo <code className="font-mono">.env</code> na raiz do projeto e
                      reinicie a API.
                    </p>
                  </div>
                )}

                <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4 pt-8 border-t border-slate-800/80">
                  <div className="p-4 rounded-xl bg-surface-container-low/70 border border-outline-variant/20">
                    <span className="material-symbols-outlined text-primary mb-2">
                      drive_folder_upload
                    </span>
                    <h3 className="text-sm font-semibold text-white">1. Selecione a pasta</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      A pasta vira Curso, subpastas viram Módulos e vídeos/PDFs viram Aulas.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-surface-container-low/70 border border-outline-variant/20">
                    <span className="material-symbols-outlined text-secondary mb-2">
                      play_circle
                    </span>
                    <h3 className="text-sm font-semibold text-white">2. Player HTML5 com Proxy</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Streaming autenticado com Range Requests, controle de velocidade e retomada.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-surface-container-low/70 border border-outline-variant/20">
                    <span className="material-symbols-outlined text-tertiary mb-2">edit_note</span>
                    <h3 className="text-sm font-semibold text-white">3. Progresso & Notas</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Anotações salvas no segundo exato do vídeo com isolamento RLS por usuário.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Dashboard Autenticado */}
        {dashboard && (
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

                  <div className="flex items-center gap-2 sm:gap-3 w-full lg:w-auto flex-wrap">
                    <div className="flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-[#182334]/85 border border-slate-700/60 text-xs sm:text-sm shadow-inner backdrop-blur-md">
                      <span className="text-sky-400 text-[15px] leading-none select-none">🔥</span>
                      <span className="text-white font-medium tracking-tight">
                        {dashboard.stats.streakDays}{' '}
                        {dashboard.stats.streakDays === 1 ? 'dia seguido' : 'dias seguidos'}
                      </span>
                    </div>

                    <button
                      onClick={() => setYtModalOpen(true)}
                      className="flex-1 sm:flex-none justify-center flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/35 font-semibold text-xs sm:text-sm transition-all"
                    >
                      <span className="material-symbols-outlined text-[18px]">smart_display</span>
                      <span>YouTube</span>
                    </button>

                    {dashboard.drive.connected ? (
                      <button
                        onClick={() => setBrowserOpen(true)}
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
                          {importing ? 'Importando...' : 'Pastas do Drive'}
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
            {dashboard.continueWatching && (
              <section className="w-full mb-6 sm:mb-8">
                <div className="p-4 sm:p-6 bg-surface-container-low rounded-2xl border border-secondary/20 shadow-xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 sm:gap-6">
                  <div className="flex-1 max-w-3xl min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded bg-secondary/15 text-secondary text-[11px] sm:text-xs font-mono font-semibold uppercase tracking-wider">
                        CONTINUAR ESTUDANDO
                      </span>
                      {dashboard.continueWatching.totalCourseSeconds > 0 && (
                        <>
                          <span className="text-outline font-mono text-xs">·</span>
                          <span className="text-[11px] sm:text-xs font-mono text-on-surface-variant">
                            {formatWatchTime(dashboard.continueWatching.watchedCourseSeconds)} de{' '}
                            {formatWatchTime(dashboard.continueWatching.totalCourseSeconds)}{' '}
                            assistidas
                          </span>
                        </>
                      )}
                    </div>
                    <h2 className="text-lg sm:text-2xl font-bold text-on-surface tracking-tight break-words">
                      {dashboard.continueWatching.courseTitle}
                    </h2>
                    <p className="text-xs sm:text-sm text-on-surface-variant mt-1 break-words">
                      <span className="text-secondary font-medium">
                        {dashboard.continueWatching.moduleTitle}:
                      </span>{' '}
                      {dashboard.continueWatching.lessonTitle}
                    </p>
                    {dashboard.continueWatching.instructorName && (
                      <div className="flex items-center gap-3 mt-2 text-xs text-outline font-mono">
                        <span>Instrutor: {dashboard.continueWatching.instructorName}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4 w-full sm:w-auto shrink-0">
                    <Link
                      href={`/courses/${dashboard.continueWatching.courseId}?lesson=${dashboard.continueWatching.lessonId}`}
                      className="w-full sm:w-auto justify-center flex items-center gap-2 px-6 py-3 rounded-xl bg-primary-container hover:bg-secondary-container text-on-primary-container font-semibold text-sm transition-all shadow-md"
                    >
                      <span
                        className="material-symbols-outlined text-[20px]"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        play_arrow
                      </span>
                      <span>Continuar aula</span>
                    </Link>
                  </div>
                </div>
              </section>
            )}

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
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
                <div>
                  <h2 className="text-xl font-bold text-on-surface tracking-tight">
                    Meus Cursos ({filteredCourses.length})
                  </h2>
                  <p className="text-xs text-outline mt-0.5">
                    Cursos sincronizados do Google Drive e playlists do YouTube em um só lugar.
                  </p>
                </div>

                <div className="flex items-center gap-2.5 flex-wrap">
                  <button
                    onClick={() => setYtModalOpen(true)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 text-xs font-semibold transition-all"
                  >
                    <span className="material-symbols-outlined text-[16px]">smart_display</span>
                    <span>Importar YouTube</span>
                  </button>

                  <button
                    onClick={() => setShowManualImport((v) => !v)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-xs text-on-surface-variant transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">link</span>
                    <span>Pasta por link/ID</span>
                  </button>

                  {dashboard.drive.connected && (
                    <button
                      onClick={() => setBrowserOpen(true)}
                      disabled={importing}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary/15 hover:bg-secondary/25 text-secondary border border-secondary/30 text-xs font-semibold transition-all disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-[16px]">folder_open</span>
                      <span>Explorar pastas do Drive</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Fallback de importação por Link ou ID */}
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
                      : 'Clique no botão abaixo para abrir o Google Picker e escolher uma pasta de curso no seu Google Drive.'}
                  </p>
                  {!searchQuery && dashboard.drive.connected && (
                    <button
                      onClick={() => setBrowserOpen(true)}
                      disabled={importing}
                      className="mt-6 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-container hover:bg-secondary-container text-on-primary-container font-semibold text-sm transition-all"
                    >
                      <span className="material-symbols-outlined text-[20px]">folder_open</span>
                      <span>
                        {importing ? 'Importando...' : 'Explorar minha pasta de cursos no Drive'}
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
                    return (
                      <div
                        key={course.id}
                        className="group rounded-2xl bg-surface-container-low border border-outline-variant/25 hover:border-primary/40 transition-all overflow-hidden flex flex-col justify-between shadow-lg"
                      >
                        <div>
                          {course.thumbnailUrl && (
                            <Link href={`/courses/${course.id}`} className="block relative h-36 w-full overflow-hidden bg-black">
                              <img
                                src={course.thumbnailUrl}
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

        <YouTubeImportModal
          open={ytModalOpen}
          onClose={() => setYtModalOpen(false)}
          onImported={handleCourseImported}
        />
      </main>
    </div>
  );
}
