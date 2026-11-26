'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import type { CourseDetail, LessonDetail, LessonNote, LessonResource } from '@devcore/shared';
import {
  attachDriveFiles,
  createLessonNote,
  deleteLessonNote,
  getAuthConfig,
  getCourseDetail,
  getDriveStreamUrl,
  getLessonNotes,
  getPickerToken,
  syncDriveCourse,
  updateLessonProgress,
} from '../../../lib/api';
import { openDriveFilesPicker } from '../../../lib/google-picker';
import { DriveFileBrowserModal } from '../../../components/DriveFileBrowserModal';
import { CourseTutorPanel } from '../../../components/CourseTutorPanel';
import { CourseEditModal } from '../../../components/CourseEditModal';
import {
  MaterialPreviewPanel,
  getMaterialKindMeta,
  getMaterialPreviewKind,
} from '../../../components/MaterialPreviewPanel';
import {
  YouTubeLessonPlayer,
  type YouTubePlayerHandle,
} from '../../../components/YouTubeLessonPlayer';
import { formatBytes, formatDurationClock, formatWatchTime } from '../../../lib/format';

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];

function isYoutubeLesson(lesson: LessonDetail): boolean {
  return (
    lesson.mimeType === 'video/youtube' ||
    Boolean(lesson.driveFileId?.startsWith('yt:video:'))
  );
}

function getYoutubeVideoId(lesson: LessonDetail): string | null {
  if (!lesson.driveFileId) return null;
  if (lesson.driveFileId.startsWith('yt:video:')) {
    return lesson.driveFileId.slice('yt:video:'.length);
  }
  return null;
}

function isVideoLesson(lesson: LessonDetail): boolean {
  if (isYoutubeLesson(lesson)) return true;
  const mime = lesson.mimeType || '';
  if (mime.startsWith('video/')) return true;
  return /\.(mp4|mkv|webm|mov|m4v|avi)$/i.test(lesson.title);
}

function isAudioLesson(lesson: LessonDetail): boolean {
  const mime = lesson.mimeType || '';
  return mime.startsWith('audio/');
}

function LessonPlayProgressRing({
  progressPercent,
  isCompleted,
  isActive,
  lessonType,
}: {
  progressPercent: number;
  isCompleted: boolean;
  isActive: boolean;
  lessonType: 'video' | 'audio' | 'doc';
}) {
  const clamped = isCompleted ? 100 : Math.min(100, Math.max(0, Math.round(progressPercent)));
  const size = 30;
  const strokeWidth = 2.6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (clamped / 100) * circumference;

  const ringColor = isCompleted
    ? '#34d399'
    : isActive
      ? '#4cd7f6'
      : clamped > 0
        ? '#adc6ff'
        : 'transparent';

  return (
    <div
      className="relative flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
      title={isCompleted ? 'Aula concluída (100%)' : `${clamped}% assistido`}
    >
      <svg width={size} height={size} className="-rotate-90">
        {/* Trilho de fundo */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill={isCompleted ? 'rgba(52, 211, 153, 0.14)' : isActive ? 'rgba(76, 215, 246, 0.12)' : 'rgba(255,255,255,0.03)'}
          stroke="rgba(140, 144, 159, 0.30)"
          strokeWidth={strokeWidth}
        />
        {/* Arco de progresso */}
        {clamped > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-all duration-300"
          />
        )}
      </svg>
      <span
        className={`material-symbols-outlined absolute text-[15px] leading-none ${
          isCompleted
            ? 'text-emerald-400'
            : isActive
              ? 'text-secondary'
              : clamped > 0
                ? 'text-primary'
                : 'text-outline'
        }`}
        style={
          !isCompleted && lessonType === 'video'
            ? { fontVariationSettings: "'FILL' 1" }
            : undefined
        }
      >
        {isCompleted
          ? 'check'
          : lessonType === 'video'
            ? 'play_arrow'
            : lessonType === 'audio'
              ? 'headphones'
              : 'description'}
      </span>
    </div>
  );
}

function CoursePlayerContent() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const courseId = params.id;
  const initialRequestedLessonRef = useRef<string | null>(searchParams.get('lesson'));

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});
  const [playbackRate, setPlaybackRate] = useState(1);
  const [autoPlay, setAutoPlay] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [theaterMode, setTheaterMode] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'lessons' | 'tutor'>('lessons');
  const [mobileTab, setMobileTab] = useState<'lessons' | 'tutor' | 'notes'>('lessons');
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [tutorDrawerOpen, setTutorDrawerOpen] = useState(false);
  const [autoPlayCountdown, setAutoPlayCountdown] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const [notes, setNotes] = useState<LessonNote[]>([]);
  const [noteInput, setNoteInput] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [previewResource, setPreviewResource] = useState<LessonResource | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [isDriveFileScope, setIsDriveFileScope] = useState(false);
  const [liveDuration, setLiveDuration] = useState(0);

  const [editModalOpen, setEditModalOpen] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytPlayerRef = useRef<YouTubePlayerHandle | null>(null);
  const shouldAutoStartRef = useRef<boolean>(false);
  const [ytAutoStart, setYtAutoStart] = useState(false);
  const lastSavedAtRef = useRef<number>(0);
  const lastReportedTimeRef = useRef<number>(0);
  const restoredForLessonRef = useRef<string | null>(null);
  const dirtyProgressRef = useRef<boolean>(false);
  const lastCrossDeviceSyncRef = useRef<number>(0);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('devcore_autoplay');
      if (saved === '1') {
        setAutoPlay(true);
      }
      const savedTheater = window.localStorage.getItem('devcore_theater_mode');
      if (savedTheater === '1') {
        setTheaterMode(true);
      }
      const savedHideCompleted = window.localStorage.getItem('devcore_hide_completed');
      if (savedHideCompleted === '1') {
        setHideCompleted(true);
      }
    } catch {
      // ignora
    }
  }, []);

  const toggleHideCompleted = () => {
    setHideCompleted((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('devcore_hide_completed', next ? '1' : '0');
      } catch {
        // ignora
      }
      return next;
    });
  };

  const toggleTheaterMode = useCallback(() => {
    setTheaterMode((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('devcore_theater_mode', next ? '1' : '0');
      } catch {
        // ignora
      }
      return next;
    });
  }, []);

  // Atalho de teclado "T" para alternar Modo Teatro (estilo YouTube)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return;
      }
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        toggleTheaterMode();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleTheaterMode]);

  const toggleAutoPlay = () => {
    setAutoPlay((prev) => {
      const next = !prev;
      if (!next) {
        setAutoPlayCountdown(null);
      }
      try {
        window.localStorage.setItem('devcore_autoplay', next ? '1' : '0');
      } catch {
        // ignora
      }
      return next;
    });
  };

  const loadCourse = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const detail = await getCourseDetail(courseId);
        setCourse(detail);

        setExpandedModules((prev) => {
          const next: Record<string, boolean> = { ...prev };
          detail.modules.forEach((m) => {
            if (next[m.id] === undefined) {
              next[m.id] = true;
            }
          });
          return next;
        });

        const allLessons = detail.modules.flatMap((m) => m.lessons);
        const requested = initialRequestedLessonRef.current;
        const preferred =
          (requested && allLessons.find((l) => l.id === requested)?.id) ||
          (detail.lastLessonId && allLessons.find((l) => l.id === detail.lastLessonId)?.id) ||
          allLessons[0]?.id ||
          null;

        setActiveLessonId((prev) => {
          if (silent) {
            const localPlaying =
              Boolean(videoRef.current && !videoRef.current.paused) ||
              Boolean(audioRef.current && !audioRef.current.paused) ||
              Boolean(ytPlayerRef.current?.isPlaying());

            if (!localPlaying) {
              // Se outro dispositivo (celular <-> PC) avançou para outra aula, acompanha automaticamente
              if (
                detail.lastLessonId &&
                allLessons.some((l) => l.id === detail.lastLessonId) &&
                prev !== detail.lastLessonId
              ) {
                dirtyProgressRef.current = false;
                if (typeof window !== 'undefined') {
                  window.history.replaceState(
                    null,
                    '',
                    `/courses/${courseId}?lesson=${detail.lastLessonId}`,
                  );
                }
                return detail.lastLessonId;
              }

              // Se é a mesma aula, mas outro dispositivo avançou o minuto, sincroniza o playhead pausado
              const serverActive = prev ? allLessons.find((l) => l.id === prev) : null;
              if (serverActive && serverActive.lastPositionSeconds >= 1) {
                const serverPos = serverActive.lastPositionSeconds;
                const localPos = isYoutubeLesson(serverActive)
                  ? ytPlayerRef.current?.getCurrentTime() || 0
                  : videoRef.current?.currentTime || audioRef.current?.currentTime || 0;
                if (Math.abs(serverPos - localPos) >= 2) {
                  if (isYoutubeLesson(serverActive)) {
                    ytPlayerRef.current?.syncPosition(serverPos);
                  } else if (videoRef.current && Number.isFinite(videoRef.current.duration)) {
                    videoRef.current.currentTime = Math.min(serverPos, videoRef.current.duration);
                  } else if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
                    audioRef.current.currentTime = Math.min(serverPos, audioRef.current.duration);
                  }
                  setCurrentTime(serverPos);
                  lastReportedTimeRef.current = serverPos;
                  dirtyProgressRef.current = false;
                }
              }
            }
          }
          return prev && allLessons.some((l) => l.id === prev) ? prev : preferred;
        });
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar o curso.');
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [courseId],
  );

  useEffect(() => {
    loadCourse(false);
    getAuthConfig()
      .then((cfg) => {
        setIsDriveFileScope(
          Boolean(
            cfg.driveScope?.includes('drive.file') && !cfg.driveScope?.includes('drive.readonly'),
          ),
        );
      })
      .catch(() => undefined);
  }, [loadCourse]);

  const flatLessons = useMemo(() => {
    if (!course) return [];
    return course.modules.flatMap((m) =>
      m.lessons.map((l) => ({ ...l, moduleTitle: m.title })),
    );
  }, [course]);

  const activeLessonIndex = useMemo(
    () => flatLessons.findIndex((l) => l.id === activeLessonId),
    [flatLessons, activeLessonId],
  );

  const activeLesson = activeLessonIndex >= 0 ? (flatLessons[activeLessonIndex] ?? null) : null;
  const prevLesson = activeLessonIndex > 0 ? (flatLessons[activeLessonIndex - 1] ?? null) : null;
  const nextLesson =
    activeLessonIndex >= 0 && activeLessonIndex < flatLessons.length - 1
      ? (flatLessons[activeLessonIndex + 1] ?? null)
      : null;

  // Carregar notas sempre que a aula ativa mudar
  useEffect(() => {
    if (!activeLessonId) {
      setNotes([]);
      return;
    }
    restoredForLessonRef.current = null;
    lastReportedTimeRef.current = 0;
    setCurrentTime(0);
    setLiveDuration(0);
    setAutoPlayCountdown(null);
    setPreviewResource(null);

    getLessonNotes(activeLessonId)
      .then(setNotes)
      .catch(() => setNotes([]));
  }, [activeLessonId]);

  // Sincronizar temporada selecionada com o episódio ativo (modo Série)
  useEffect(() => {
    if (activeLesson?.moduleId) {
      setSelectedSeasonId(activeLesson.moduleId);
    }
  }, [activeLesson?.moduleId]);

  // Aplicar velocidade de reprodução
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, activeLessonId]);

  const persistProgress = useCallback(
    async (
      lessonId: string,
      positionSeconds: number,
      durationSeconds: number,
      explicitCompleted?: boolean,
      watchedDeltaSeconds = 0,
      keepalive = false,
    ) => {
      try {
        await updateLessonProgress(
          lessonId,
          {
            positionSeconds: Math.floor(positionSeconds),
            durationSeconds: Math.floor(durationSeconds),
            isCompleted: explicitCompleted,
            watchedDeltaSeconds: Math.floor(watchedDeltaSeconds),
          },
          keepalive,
        );

        setCourse((prev) => {
          if (!prev) return prev;
          let completedCount = 0;
          let totalCount = 0;
          const updatedModules = prev.modules.map((mod) => ({
            ...mod,
            lessons: mod.lessons.map((les) => {
              totalCount++;
              if (les.id !== lessonId) {
                if (les.isCompleted) completedCount++;
                return les;
              }
              const nextCompleted =
                typeof explicitCompleted === 'boolean'
                  ? explicitCompleted
                  : les.isCompleted ||
                    (durationSeconds > 0 && positionSeconds >= durationSeconds * 0.85);
              if (nextCompleted) completedCount++;
              return {
                ...les,
                lastPositionSeconds: Math.floor(positionSeconds),
                durationSeconds:
                  les.durationSeconds === 0 && durationSeconds > 0
                    ? Math.floor(durationSeconds)
                    : les.durationSeconds,
                isCompleted: nextCompleted,
              };
            }),
          }));

          return {
            ...prev,
            modules: updatedModules,
            completedLessonsCount: completedCount,
            progressPercent: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
          };
        });
      } catch {
        // Falha silenciosa de progresso para não interromper o vídeo
      }
    },
    [],
  );

  const selectLesson = useCallback(
    (lessonId: string, autoStart = false) => {
      // Salva o progresso da aula que o usuário está saindo (sem bloquear a troca instantânea)
      if (activeLesson && activeLesson.id !== lessonId) {
        const pos = isYoutubeLesson(activeLesson)
          ? ytPlayerRef.current?.getCurrentTime() || currentTime
          : videoRef.current?.currentTime || audioRef.current?.currentTime || currentTime;
        const dur = isYoutubeLesson(activeLesson)
          ? ytPlayerRef.current?.getDuration() || liveDuration || activeLesson.durationSeconds
          : videoRef.current?.duration || audioRef.current?.duration || activeLesson.durationSeconds;
        if (pos > 0 && dirtyProgressRef.current) {
          persistProgress(activeLesson.id, pos, dur);
        }
      }

      // Registra imediatamente a aula escolhida como última acessada para sincronizar celular <-> PC
      const nextTarget = flatLessons.find((l) => l.id === lessonId);
      if (nextTarget) {
        persistProgress(
          nextTarget.id,
          nextTarget.lastPositionSeconds || 0,
          nextTarget.durationSeconds || 0,
        );
      }

      dirtyProgressRef.current = false;
      shouldAutoStartRef.current = autoStart;
      setYtAutoStart(autoStart);
      setAutoPlayCountdown(null);
      setActiveLessonId(lessonId);
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', `/courses/${courseId}?lesson=${lessonId}`);
      }
    },
    [activeLesson, courseId, currentTime, flatLessons, liveDuration, persistProgress],
  );

  // Sincronização entre dispositivos (Celular <-> PC):
  // - Salva ao sair da aba apenas se houve atividade local (não sobrescreve progresso mais novo de outro dispositivo)
  // - Recarrega silenciosamente ao voltar para a aba ou focar a janela
  useEffect(() => {
    const flushCurrentProgress = () => {
      if (!activeLesson || !dirtyProgressRef.current) return;
      const pos = isYoutubeLesson(activeLesson)
        ? ytPlayerRef.current?.getCurrentTime() || currentTime
        : videoRef.current?.currentTime || audioRef.current?.currentTime || currentTime;
      const dur = isYoutubeLesson(activeLesson)
        ? ytPlayerRef.current?.getDuration() || liveDuration || activeLesson.durationSeconds
        : videoRef.current?.duration || audioRef.current?.duration || activeLesson.durationSeconds;
      const delta = Math.max(0, Math.min(30, pos - lastReportedTimeRef.current));
      lastReportedTimeRef.current = pos;
      dirtyProgressRef.current = false;
      persistProgress(activeLesson.id, pos, dur, undefined, delta, true);
    };

    const syncFromServer = () => {
      const now = Date.now();
      if (now - lastCrossDeviceSyncRef.current < 3000) return;
      lastCrossDeviceSyncRef.current = now;
      loadCourse(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushCurrentProgress();
      } else if (document.visibilityState === 'visible') {
        syncFromServer();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', syncFromServer);
    window.addEventListener('pagehide', flushCurrentProgress);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', syncFromServer);
      window.removeEventListener('pagehide', flushCurrentProgress);
    };
  }, [activeLesson, currentTime, liveDuration, loadCourse, persistProgress]);

  // Contagem regressiva do Autoplay para próxima aula
  useEffect(() => {
    if (autoPlayCountdown === null) return;
    if (!autoPlay || !nextLesson) {
      setAutoPlayCountdown(null);
      return;
    }
    if (autoPlayCountdown <= 0) {
      selectLesson(nextLesson.id, true);
      return;
    }
    const timer = window.setTimeout(() => {
      setAutoPlayCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [autoPlayCountdown, autoPlay, nextLesson, selectLesson]);

  const handleVideoLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video || !activeLesson) return;

    video.playbackRate = playbackRate;
    if (video.duration && Number.isFinite(video.duration)) {
      setLiveDuration(video.duration);
    }

    if (restoredForLessonRef.current !== activeLesson.id) {
      restoredForLessonRef.current = activeLesson.id;
      const savedPos = activeLesson.lastPositionSeconds || 0;
      if (savedPos >= 1 && video.duration && savedPos < video.duration * 0.97) {
        video.currentTime = savedPos;
        setCurrentTime(savedPos);
        lastReportedTimeRef.current = savedPos;
      }
      if (activeLesson.durationSeconds === 0 && video.duration > 0) {
        persistProgress(activeLesson.id, savedPos, video.duration);
      }
    }

    if (shouldAutoStartRef.current) {
      shouldAutoStartRef.current = false;
      video.play().catch(() => undefined);
    }
  };

  const handleVideoTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !activeLesson) return;
    setCurrentTime(video.currentTime);
    if (!video.paused) {
      dirtyProgressRef.current = true;
    }

    const now = Date.now();
    if (now - lastSavedAtRef.current >= 10_000) {
      const delta = Math.max(0, Math.min(30, video.currentTime - lastReportedTimeRef.current));
      lastSavedAtRef.current = now;
      lastReportedTimeRef.current = video.currentTime;
      dirtyProgressRef.current = false;
      persistProgress(activeLesson.id, video.currentTime, video.duration || 0, undefined, delta);
    }
  };

  const handleVideoPauseOrEnd = (ended = false) => {
    const video = videoRef.current;
    if (!video || !activeLesson) return;
    const delta = Math.max(0, Math.min(30, video.currentTime - lastReportedTimeRef.current));
    lastSavedAtRef.current = Date.now();
    lastReportedTimeRef.current = video.currentTime;
    dirtyProgressRef.current = false;
    persistProgress(
      activeLesson.id,
      video.currentTime,
      video.duration || activeLesson.durationSeconds,
      ended ? true : undefined,
      delta,
    );

    if (ended && autoPlay && nextLesson) {
      setAutoPlayCountdown(3);
    }
  };

  const handleAudioEnded = () => {
    if (!activeLesson) return;
    const dur = audioRef.current?.duration || activeLesson.durationSeconds;
    dirtyProgressRef.current = false;
    persistProgress(activeLesson.id, dur, dur, true);
    if (autoPlay && nextLesson) {
      setAutoPlayCountdown(3);
    }
  };

  const handleYoutubeReady = (durationSeconds: number) => {
    if (!activeLesson) return;
    if (durationSeconds > 0 && Number.isFinite(durationSeconds)) {
      setLiveDuration(durationSeconds);
      if (activeLesson.durationSeconds === 0) {
        persistProgress(activeLesson.id, activeLesson.lastPositionSeconds || 0, durationSeconds);
      }
    }
    if (activeLesson.lastPositionSeconds >= 1) {
      lastReportedTimeRef.current = activeLesson.lastPositionSeconds;
      setCurrentTime(activeLesson.lastPositionSeconds);
    }
  };

  const handleYoutubeTimeUpdate = (pos: number, dur: number) => {
    if (!activeLesson) return;
    setCurrentTime(pos);
    dirtyProgressRef.current = true;
    if (dur > 0 && Number.isFinite(dur)) {
      setLiveDuration(dur);
    }
    const now = Date.now();
    if (now - lastSavedAtRef.current >= 10_000) {
      const delta = Math.max(0, Math.min(30, pos - lastReportedTimeRef.current));
      lastSavedAtRef.current = now;
      lastReportedTimeRef.current = pos;
      dirtyProgressRef.current = false;
      persistProgress(activeLesson.id, pos, dur || activeLesson.durationSeconds, undefined, delta);
    }
  };

  const handleYoutubePause = (pos: number, dur: number) => {
    if (!activeLesson) return;
    const delta = Math.max(0, Math.min(30, pos - lastReportedTimeRef.current));
    lastSavedAtRef.current = Date.now();
    lastReportedTimeRef.current = pos;
    dirtyProgressRef.current = false;
    persistProgress(activeLesson.id, pos, dur || activeLesson.durationSeconds, undefined, delta);
  };

  const handleYoutubeEnded = (dur: number) => {
    if (!activeLesson) return;
    const finalDur = dur || activeLesson.durationSeconds;
    const delta = Math.max(0, Math.min(30, finalDur - lastReportedTimeRef.current));
    lastSavedAtRef.current = Date.now();
    lastReportedTimeRef.current = finalDur;
    dirtyProgressRef.current = false;
    persistProgress(activeLesson.id, finalDur, finalDur, true, delta);
    if (autoPlay && nextLesson) {
      setAutoPlayCountdown(3);
    }
  };

  const handleToggleCompleted = () => {
    if (!activeLesson) return;
    const nextState = !activeLesson.isCompleted;
    const pos = isYoutubeLesson(activeLesson)
      ? ytPlayerRef.current?.getCurrentTime() || currentTime || activeLesson.lastPositionSeconds
      : videoRef.current?.currentTime || activeLesson.lastPositionSeconds;
    const dur = isYoutubeLesson(activeLesson)
      ? ytPlayerRef.current?.getDuration() || liveDuration || activeLesson.durationSeconds
      : videoRef.current?.duration || activeLesson.durationSeconds;
    persistProgress(activeLesson.id, pos, dur, nextState);
  };

  const handlePictureInPicture = async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      // ignora se navegador bloquear
    }
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLesson || !noteInput.trim()) return;
    setSavingNote(true);
    try {
      const rawTime = isYoutubeLesson(activeLesson)
        ? ytPlayerRef.current?.getCurrentTime() ?? currentTime
        : videoRef.current?.currentTime;
      const timestamp = rawTime !== undefined ? Math.floor(rawTime) : undefined;
      const created = await createLessonNote(activeLesson.id, {
        content: noteInput.trim(),
        timeSeconds: timestamp,
      });
      setNotes((prev) =>
        [...prev, created].sort((a, b) => (a.timeSeconds ?? 999999) - (b.timeSeconds ?? 999999)),
      );
      setNoteInput('');
    } catch (err) {
      setStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erro ao salvar anotação.',
      });
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!activeLesson) return;
    await deleteLessonNote(activeLesson.id, noteId).catch(() => undefined);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  };

  const jumpToTimestamp = (seconds: number) => {
    if (activeLesson && isYoutubeLesson(activeLesson) && ytPlayerRef.current) {
      ytPlayerRef.current.seekTo(seconds);
      return;
    }
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play().catch(() => undefined);
    }
  };

  const handleSyncCourse = async () => {
    setSyncing(true);
    setStatusMsg(null);
    try {
      const res = await syncDriveCourse(courseId);
      setStatusMsg({
        type: res.warning ? 'warning' : 'success',
        text:
          res.warning ||
          `Curso sincronizado: ${res.modulesCount} módulo(s), ${res.lessonsCount} aula(s) e ${res.documentsCount} documento(s).`,
      });
      await loadCourse(true);
    } catch (err) {
      setStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erro ao sincronizar curso.',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleAttachFilesFromPicker = async () => {
    setAttaching(true);
    setStatusMsg(null);
    try {
      const tokenInfo = await getPickerToken();
      const rawParent = course?.driveFolderId || 'root';
      const safeParent =
        rawParent.startsWith('picked:') ||
        rawParent.startsWith('movie:') ||
        rawParent.startsWith('yt:')
          ? 'root'
          : rawParent;
      const picked = await openDriveFilesPicker(
        tokenInfo,
        safeParent,
        course?.contentType === 'series'
          ? 'Selecione os episódios da temporada no Google Drive'
          : 'Selecione os vídeos e materiais das aulas',
      );
      if (picked.length === 0) {
        setAttaching(false);
        return;
      }

      const res = await attachDriveFiles(courseId, {
        files: picked,
      });
      setStatusMsg({
        type: 'success',
        text: `${res.addedLessons} aula(s) e ${res.addedDocuments} documento(s) adicionados ao curso!`,
      });
      await loadCourse(true);
    } catch (err) {
      setStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erro ao adicionar arquivos do Drive.',
      });
    } finally {
      setAttaching(false);
    }
  };

  const handleFilesAttachedFromBrowser = async (res: {
    addedLessons: number;
    addedDocuments: number;
  }) => {
    setStatusMsg({
      type: 'success',
      text: `${res.addedLessons} aula(s) e ${res.addedDocuments} documento(s) adicionados ao curso!`,
    });
    await loadCourse(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-3 text-outline">
        <span className="material-symbols-outlined text-4xl text-primary animate-spin">
          progress_activity
        </span>
        <p className="text-sm">Carregando curso do Google Drive...</p>
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6 text-center">
        <span className="material-symbols-outlined text-5xl text-error mb-3">error</span>
        <h1 className="text-xl font-bold text-on-surface">{error || 'Curso não encontrado'}</h1>
        <Link
          href="/"
          className="mt-5 px-5 py-2.5 rounded-xl bg-primary-container text-on-primary-container font-semibold text-sm"
        >
          Voltar para a Biblioteca
        </Link>
      </div>
    );
  }

  const isYoutubeCourse =
    course.sourceType === 'youtube' || Boolean(course.driveFolderId?.startsWith('yt:playlist:'));
  const contentType = course.contentType || 'course';
  const isMovie = contentType === 'movie';
  const isSeries = contentType === 'series';
  const isStreaming = isMovie || isSeries;

  const activeSeason =
    course.modules.find((m) => m.id === selectedSeasonId) ||
    course.modules.find((m) => m.id === activeLesson?.moduleId) ||
    course.modules[0] ||
    null;

  const renderSeriesSeasonsPanel = (maxHeightClass = 'max-h-[calc(100vh-255px)]') => (
    <div className="flex flex-col">
      {/* Seletor de Temporadas */}
      <div className="p-3.5 border-b border-outline-variant/20 bg-surface-container/60 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-white flex items-center gap-1.5">
            <span className="material-symbols-outlined text-fuchsia-400 text-[17px]">live_tv</span>
            <span>Temporadas ({course.modules.length})</span>
          </span>
          <span className="text-[11px] font-mono text-outline">
            {course.lessonsCount} {course.lessonsCount === 1 ? 'episódio' : 'episódios'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {course.modules.map((season, sIdx) => {
            const isSelected = activeSeason?.id === season.id;
            return (
              <button
                key={season.id}
                type="button"
                onClick={() => setSelectedSeasonId(season.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-all border ${
                  isSelected
                    ? 'bg-gradient-to-r from-fuchsia-600 to-rose-600 text-white border-transparent shadow'
                    : 'bg-surface-container-low text-on-surface-variant border-outline-variant/25 hover:text-white hover:border-fuchsia-500/40'
                }`}
              >
                {season.title || `Temporada ${sIdx + 1}`}
              </button>
            );
          })}
        </div>
      </div>

      {/* Lista de Episódios da Temporada Selecionada */}
      <div className={`${maxHeightClass} overflow-y-auto divide-y divide-outline-variant/10`}>
        {(activeSeason?.lessons || []).map((ep, epIdx) => {
          const isActive = ep.id === activeLessonId;
          const effectiveDuration =
            isActive && liveDuration > 0 ? liveDuration : ep.durationSeconds;
          const effectivePosition =
            isActive && currentTime > 0
              ? Math.max(currentTime, ep.lastPositionSeconds)
              : ep.lastPositionSeconds;
          const epProgress = ep.isCompleted
            ? 100
            : effectiveDuration > 0
              ? Math.min(99, Math.round((effectivePosition / effectiveDuration) * 100))
              : effectivePosition > 0
                ? 15
                : 0;

          return (
            <button
              key={ep.id}
              type="button"
              onClick={() => selectLesson(ep.id, true)}
              className={`w-full px-4 py-3 text-left flex items-center gap-3 transition-colors ${
                isActive
                  ? 'bg-fuchsia-500/15 border-l-2 border-fuchsia-400'
                  : 'hover:bg-surface-container/60'
              }`}
            >
              <LessonPlayProgressRing
                progressPercent={epProgress}
                isCompleted={ep.isCompleted}
                isActive={isActive}
                lessonType="video"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono font-bold text-fuchsia-300 shrink-0">
                    E{String(epIdx + 1).padStart(2, '0')}
                  </span>
                  <span
                    className={`text-xs leading-snug truncate ${
                      isActive ? 'font-bold text-white' : 'font-medium text-on-surface-variant'
                    }`}
                  >
                    {ep.title}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-outline">
                  {effectiveDuration > 0 && <span>{formatDurationClock(effectiveDuration)}</span>}
                  {!ep.isCompleted && epProgress > 0 && (
                    <span className="text-rose-300">{epProgress}% assistido</span>
                  )}
                  {ep.isCompleted && <span className="text-emerald-400">Assistido</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  const handleOpenTutor = () => {
    const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
    if (isDesktop && !theaterMode) {
      setSidebarTab((prev) => (prev === 'tutor' ? 'lessons' : 'tutor'));
    } else if (!isDesktop) {
      setMobileTab('tutor');
    } else {
      setTutorDrawerOpen(true);
    }
  };

  const renderCurriculumTree = () => (
    <div className="divide-y divide-outline-variant/15">
      {course.modules.map((mod) => {
        const isOpen = expandedModules[mod.id] ?? true;
        const completedInMod = mod.lessons.filter((l) => l.isCompleted).length;
        const visibleLessons = hideCompleted
          ? mod.lessons.filter((l) => !l.isCompleted || l.id === activeLessonId)
          : mod.lessons;

        if (hideCompleted && visibleLessons.length === 0) {
          return null;
        }

        return (
          <div key={mod.id}>
            <button
              onClick={() =>
                setExpandedModules((prev) => ({ ...prev, [mod.id]: !isOpen }))
              }
              className="w-full px-4 py-3 flex items-center justify-between gap-2 bg-surface-container/60 hover:bg-surface-container text-left transition-colors"
            >
              <div className="min-w-0">
                <div className="text-xs font-bold text-on-surface truncate">
                  {mod.title}
                </div>
                <div className="text-[10px] font-mono text-outline mt-0.5">
                  {completedInMod}/{mod.lessons.length} concluídas
                </div>
              </div>
              <span className="material-symbols-outlined text-[18px] text-outline shrink-0">
                {isOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>

            {isOpen && (
              <div className="divide-y divide-outline-variant/10">
                {visibleLessons.map((lesson) => {
                  const isActive = lesson.id === activeLessonId;
                  const effectiveDuration =
                    isActive && liveDuration > 0 ? liveDuration : lesson.durationSeconds;
                  const effectivePosition =
                    isActive && currentTime > 0
                      ? Math.max(currentTime, lesson.lastPositionSeconds)
                      : lesson.lastPositionSeconds;
                  const lessonProgress = lesson.isCompleted
                    ? 100
                    : effectiveDuration > 0
                      ? Math.min(99, Math.round((effectivePosition / effectiveDuration) * 100))
                      : effectivePosition > 0
                        ? 15
                        : 0;
                  const lessonType = isVideoLesson(lesson)
                    ? 'video'
                    : isAudioLesson(lesson)
                      ? 'audio'
                      : 'doc';

                  return (
                    <button
                      key={lesson.id}
                      onClick={() => selectLesson(lesson.id)}
                      className={`w-full px-4 py-3 text-left flex items-center gap-3 transition-colors ${
                        isActive
                          ? 'bg-primary/15 border-l-2 border-primary'
                          : 'hover:bg-surface-container/50'
                      }`}
                    >
                      <LessonPlayProgressRing
                        progressPercent={lessonProgress}
                        isCompleted={lesson.isCompleted}
                        isActive={isActive}
                        lessonType={lessonType}
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-xs leading-snug ${
                            isActive
                              ? 'font-bold text-white'
                              : 'font-medium text-on-surface-variant'
                          }`}
                        >
                          {lesson.title}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-outline">
                          {effectiveDuration > 0 && (
                            <span>{formatDurationClock(effectiveDuration)}</span>
                          )}
                          {!lesson.isCompleted && lessonProgress > 0 && (
                            <span className="text-secondary">{lessonProgress}%</span>
                          )}
                          {lesson.resources.length > 0 && (
                            <span>· {lesson.resources.length} anexo(s)</span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-surface overflow-x-hidden">
      {/* Barra Superior do Player */}
      <header className="sticky top-0 z-40 min-h-14 sm:h-16 py-2 sm:py-0 bg-surface/90 backdrop-blur-xl border-b border-outline-variant/25 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link
            href={isStreaming ? '/?mode=streaming' : '/'}
            className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs text-on-surface-variant transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            <span className="hidden sm:inline">{isStreaming ? 'Streaming' : 'Biblioteca'}</span>
          </Link>

          <div className="min-w-0">
            <h1 className="text-xs sm:text-base font-bold text-on-surface truncate">
              {course.title}
            </h1>
            <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] font-mono text-outline truncate">
              {isMovie ? (
                <>
                  <span className="text-rose-300 font-bold uppercase">Filme</span>
                  {course.totalDurationSeconds > 0 && (
                    <>
                      <span>·</span>
                      <span>{formatWatchTime(course.totalDurationSeconds)}</span>
                    </>
                  )}
                </>
              ) : isSeries ? (
                <>
                  <span className="text-fuchsia-300 font-bold uppercase">Série</span>
                  <span>·</span>
                  <span>
                    {course.modulesCount}{' '}
                    {course.modulesCount === 1 ? 'temporada' : 'temporadas'} ·{' '}
                    {course.lessonsCount}{' '}
                    {course.lessonsCount === 1 ? 'episódio' : 'episódios'}
                  </span>
                </>
              ) : (
                <>
                  <span>{course.progressPercent}%</span>
                  <span>·</span>
                  <span>
                    {course.completedLessonsCount}/{course.lessonsCount} aulas
                  </span>
                  {course.totalDurationSeconds > 0 && (
                    <>
                      <span className="hidden sm:inline">·</span>
                      <span className="hidden sm:inline">
                        {formatWatchTime(course.totalDurationSeconds)}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {!isStreaming && (
            <button
              onClick={handleOpenTutor}
              title="Abrir Tutor IA Gemini deste curso"
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                sidebarTab === 'tutor' || tutorDrawerOpen
                  ? 'bg-secondary/20 text-secondary border-secondary/50'
                  : 'bg-secondary/10 hover:bg-secondary/20 text-secondary border-secondary/30'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
              <span className="hidden xs:inline sm:inline">Tutor IA</span>
            </button>
          )}

          {!isYoutubeCourse && !isMovie && (
            <button
              onClick={() => {
                if (isDriveFileScope || course.driveFolderId?.startsWith('picked:')) {
                  handleAttachFilesFromPicker();
                } else {
                  setFileBrowserOpen(true);
                }
              }}
              disabled={attaching}
              title="Adicionar arquivos do Google Drive"
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface border border-outline-variant/30 text-xs font-medium transition-all disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">add_to_drive</span>
              <span className="hidden xl:inline">
                {attaching ? 'Carregando...' : 'Adicionar arquivos'}
              </span>
            </button>
          )}

          <button
            onClick={handleSyncCourse}
            disabled={syncing}
            title="Sincronizar com o Google Drive"
            className="flex items-center gap-1.5 p-1.5 sm:px-3 sm:py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-xs text-on-surface transition-colors disabled:opacity-50"
          >
            <span
              className={`material-symbols-outlined text-[16px] ${syncing ? 'animate-spin' : ''}`}
            >
              sync
            </span>
            <span className="hidden md:inline">Sincronizar</span>
          </button>

          <button
            onClick={() => setEditModalOpen(true)}
            title="Editar capa e informações"
            className="p-1.5 sm:p-2 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-on-surface-variant"
          >
            <span className="material-symbols-outlined text-[16px]">edit</span>
          </button>
        </div>
      </header>

      {statusMsg && (
        <div
          className={`mx-4 sm:mx-6 mt-4 p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
            statusMsg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              : statusMsg.type === 'warning'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                : 'bg-error/10 border-error/30 text-error'
          }`}
        >
          <span>{statusMsg.text}</span>
          <button onClick={() => setStatusMsg(null)}>
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Workspace Principal: Molda-se para Curso, Filme (Cinema) ou Série (Temporadas) */}
      <div
        className={`flex-1 w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 transition-all ${
          isMovie ? 'max-w-[1360px]' : theaterMode ? 'max-w-[1920px]' : 'max-w-[1700px]'
        }`}
      >
        {/* Área do Player + Controles */}
        <div
          className={`${isMovie || theaterMode ? 'lg:col-span-12' : 'lg:col-span-8'} flex flex-col gap-4 sm:gap-6 min-w-0 transition-all`}
        >
          {!activeLesson ? (
            <div className="rounded-2xl border border-dashed border-outline-variant/40 bg-surface-container-low p-10 text-center">
              <span className="material-symbols-outlined text-5xl text-primary mb-3">
                video_library
              </span>
              <h2 className="text-lg font-bold text-on-surface">
                Nenhuma aula carregada neste curso ainda
              </h2>
              <p className="text-sm text-outline max-w-lg mx-auto mt-2 leading-relaxed">
                Com o escopo <code className="font-mono text-secondary">drive.file</code>, o Google
                Drive exige autorização explícita para os arquivos internos da pasta. Clique abaixo
                para selecionar os vídeos e PDFs das aulas diretamente no Google Picker.
              </p>
              <button
                onClick={() => setFileBrowserOpen(true)}
                disabled={attaching}
                className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-container hover:bg-secondary-container text-on-primary-container font-semibold text-sm transition-all"
              >
                <span className="material-symbols-outlined text-[20px]">add_to_drive</span>
                <span>Selecionar vídeos e materiais do Drive</span>
              </button>
            </div>
          ) : (
            <>
              {/* Cabeçalho Mobile acima do vídeo */}
              <div className="lg:hidden space-y-2.5">
                <div className="text-[11px] font-mono text-outline truncate">
                  <Link
                    href={isStreaming ? '/?mode=streaming' : '/'}
                    className="hover:text-on-surface"
                  >
                    {isStreaming ? 'Streaming' : 'Início'}
                  </Link>{' '}
                  / <span>{course.title}</span>
                  {!isMovie && (
                    <>
                      {' '}
                      /{' '}
                      <span className={isSeries ? 'text-fuchsia-300' : 'text-secondary'}>
                        {activeLesson.moduleTitle}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-start gap-2.5">
                  <span
                    className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider shrink-0 mt-0.5 ${
                      isMovie
                        ? 'bg-rose-500/20 text-rose-300'
                        : isSeries
                          ? 'bg-fuchsia-500/20 text-fuchsia-300'
                          : 'bg-primary/15 text-primary'
                    }`}
                  >
                    {isMovie
                      ? 'FILME'
                      : isSeries
                        ? `EP ${String(activeLessonIndex + 1).padStart(2, '0')}`
                        : `AULA ${String(activeLessonIndex + 1).padStart(2, '0')}`}
                  </span>
                  <h2 className="text-lg font-extrabold text-white leading-snug break-words">
                    {isMovie ? course.title : activeLesson.title}
                  </h2>
                </div>

                {!isMovie && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      disabled={!prevLesson}
                      onClick={() => prevLesson && selectLesson(prevLesson.id)}
                      title={isSeries ? 'Episódio anterior' : 'Aula anterior'}
                      className="h-9 w-9 rounded-xl bg-surface-container hover:bg-surface-container-high border border-outline-variant/25 flex items-center justify-center text-on-surface disabled:opacity-35 shrink-0"
                    >
                      <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                    </button>
                    <button
                      disabled={!nextLesson}
                      onClick={() => nextLesson && selectLesson(nextLesson.id, isSeries)}
                      className={`h-9 px-4 rounded-xl text-xs font-bold flex items-center gap-1 disabled:opacity-35 ${
                        isSeries
                          ? 'bg-gradient-to-r from-fuchsia-600 to-rose-600 text-white'
                          : 'bg-primary-container hover:bg-secondary-container text-on-primary-container'
                      }`}
                    >
                      <span>{isSeries ? 'Próximo episódio' : 'Próxima aula'}</span>
                      <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                    </button>
                    {!isSeries && (
                      <button
                        onClick={handleToggleCompleted}
                        className={`ml-auto h-9 px-3 rounded-xl text-xs font-semibold border flex items-center gap-1 transition-all ${
                          activeLesson.isCompleted
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                            : 'bg-surface-container text-on-surface-variant border-outline-variant/30'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          {activeLesson.isCompleted ? 'check_circle' : 'radio_button_unchecked'}
                        </span>
                        <span>{activeLesson.isCompleted ? 'Concluída' : 'Concluir'}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Container de Mídia */}
              <div
                className={`relative overflow-hidden bg-black border border-outline-variant/25 shadow-2xl transition-all ${
                  theaterMode
                    ? '-mx-3 sm:mx-0 rounded-none sm:rounded-2xl'
                    : 'rounded-xl sm:rounded-2xl'
                }`}
              >
                {isYoutubeLesson(activeLesson) && getYoutubeVideoId(activeLesson) ? (
                  <YouTubeLessonPlayer
                    key={activeLesson.id}
                    ref={ytPlayerRef}
                    videoId={getYoutubeVideoId(activeLesson)!}
                    initialPositionSeconds={
                      activeLesson.durationSeconds > 0 &&
                      activeLesson.lastPositionSeconds < activeLesson.durationSeconds * 0.96
                        ? activeLesson.lastPositionSeconds
                        : activeLesson.durationSeconds === 0
                          ? activeLesson.lastPositionSeconds
                          : 0
                    }
                    playbackRate={playbackRate}
                    autoStart={ytAutoStart}
                    className={
                      theaterMode
                        ? 'w-full h-[76vh] max-h-[820px] bg-black'
                        : 'w-full aspect-video bg-black'
                    }
                    onReady={handleYoutubeReady}
                    onTimeUpdate={handleYoutubeTimeUpdate}
                    onPause={handleYoutubePause}
                    onEnded={handleYoutubeEnded}
                  />
                ) : activeLesson.driveFileId && isVideoLesson(activeLesson) ? (
                  <video
                    key={activeLesson.id}
                    ref={videoRef}
                    src={getDriveStreamUrl(activeLesson.driveFileId)}
                    controls
                    playsInline
                    crossOrigin="use-credentials"
                    onLoadedMetadata={handleVideoLoadedMetadata}
                    onTimeUpdate={handleVideoTimeUpdate}
                    onPause={() => handleVideoPauseOrEnd(false)}
                    onEnded={() => handleVideoPauseOrEnd(true)}
                    className={
                      theaterMode
                        ? 'w-full max-h-[78vh] aspect-video bg-black mx-auto'
                        : 'w-full aspect-video bg-black'
                    }
                  />
                ) : activeLesson.driveFileId && isAudioLesson(activeLesson) ? (
                  <div className="p-10 flex flex-col items-center justify-center bg-surface-container-lowest gap-4">
                    <span className="material-symbols-outlined text-6xl text-secondary">
                      headphones
                    </span>
                    <audio
                      key={activeLesson.id}
                      ref={audioRef}
                      src={getDriveStreamUrl(activeLesson.driveFileId)}
                      controls
                      crossOrigin="use-credentials"
                      onLoadedMetadata={() => {
                        if (shouldAutoStartRef.current) {
                          shouldAutoStartRef.current = false;
                          audioRef.current?.play().catch(() => undefined);
                        }
                      }}
                      onEnded={handleAudioEnded}
                      className="w-full max-w-xl"
                    />
                  </div>
                ) : activeLesson.driveFileId ? (
                  <div className="bg-surface-container-lowest">
                    <iframe
                      key={activeLesson.id}
                      src={getDriveStreamUrl(activeLesson.driveFileId)}
                      title={activeLesson.title}
                      className="w-full h-[420px] sm:h-[580px] border-0 bg-white"
                    />
                  </div>
                ) : (
                  <div className="aspect-video flex items-center justify-center text-outline text-sm">
                    Arquivo de mídia não vinculado.
                  </div>
                )}

                {/* Overlay de contagem regressiva do Autoplay */}
                {autoPlayCountdown !== null && nextLesson && (
                  <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-20">
                    <span className="text-xs font-mono uppercase tracking-widest text-secondary mb-2">
                      AUTOPLAY · PRÓXIMA AULA EM {autoPlayCountdown}s
                    </span>
                    <h3 className="text-lg sm:text-xl font-bold text-white max-w-lg">
                      {nextLesson.title}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">{nextLesson.moduleTitle}</p>
                    <div className="flex items-center gap-3 mt-5">
                      <button
                        onClick={() => setAutoPlayCountdown(null)}
                        className="px-4 py-2 rounded-xl bg-surface-container-high hover:bg-surface-bright text-xs font-semibold text-on-surface"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => selectLesson(nextLesson.id, true)}
                        className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-primary-container hover:bg-secondary-container text-on-primary-container text-xs font-bold"
                      >
                        <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                        <span>Assistir agora</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Controles Mobile Enxutos */}
              <div className="lg:hidden rounded-2xl bg-surface-container-low border border-outline-variant/25 p-3.5 space-y-3">
                {!isMovie && (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    {(isVideoLesson(activeLesson) || isAudioLesson(activeLesson)) && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={autoPlay}
                        onClick={toggleAutoPlay}
                        className="flex items-center gap-2 text-xs font-medium text-on-surface"
                      >
                        <span
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            autoPlay ? 'bg-primary-container' : 'bg-outline-variant'
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                              autoPlay ? 'translate-x-[18px]' : 'translate-x-1'
                            }`}
                          />
                        </span>
                        <span>Autoplay</span>
                      </button>
                    )}

                    {!isSeries && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={hideCompleted}
                        onClick={toggleHideCompleted}
                        className="flex items-center gap-2 text-xs font-medium text-on-surface-variant"
                      >
                        <span
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            hideCompleted ? 'bg-secondary' : 'bg-outline-variant'
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                              hideCompleted ? 'translate-x-[18px]' : 'translate-x-1'
                            }`}
                          />
                        </span>
                        <span>Ocultar concluídas</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={toggleTheaterMode}
                      title={theaterMode ? 'Sair do modo teatro' : 'Ativar modo teatro'}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1 transition-all ${
                        theaterMode
                          ? 'bg-primary/15 text-primary border-primary/40'
                          : 'bg-surface-container text-on-surface-variant border-outline-variant/25'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[15px]">
                        {theaterMode ? 'right_panel_open' : 'width_wide'}
                      </span>
                      <span>{theaterMode ? 'Sair do teatro' : 'Teatro'}</span>
                    </button>
                  </div>
                )}

                {isVideoLesson(activeLesson) && (
                  <div
                    className={`flex items-center gap-2.5 ${
                      !isMovie ? 'pt-2.5 border-t border-outline-variant/20' : ''
                    }`}
                  >
                    <span className="text-xs text-outline shrink-0">Velocidade</span>
                    <div className="flex items-center gap-1 overflow-x-auto bg-surface-container-lowest p-1 rounded-xl border border-outline-variant/20 flex-1">
                      {PLAYBACK_RATES.map((rate) => (
                        <button
                          key={rate}
                          onClick={() => setPlaybackRate(rate)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-colors shrink-0 ${
                            playbackRate === rate
                              ? isStreaming
                                ? 'bg-gradient-to-r from-fuchsia-600 to-rose-600 text-white font-bold'
                                : 'bg-primary-container text-on-primary-container font-bold'
                              : 'text-on-surface-variant hover:text-on-surface'
                          }`}
                        >
                          {rate.toFixed(rate % 1 === 0 ? 1 : 2).replace(/\.00$/, '.0')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Abas Mobile abaixo do vídeo: Curso (Aulas|Tutor|Notas), Série (Temporadas), Filme (Sinopse) */}
              {!theaterMode && isMovie && course.description && (
                <div className="lg:hidden rounded-2xl bg-surface-container-low border border-outline-variant/25 p-4 space-y-1.5">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-rose-300">
                    Sinopse
                  </span>
                  <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {course.description}
                  </p>
                </div>
              )}

              {!theaterMode && isSeries && (
                <div className="lg:hidden rounded-2xl bg-surface-container-low border border-outline-variant/25 overflow-hidden">
                  {renderSeriesSeasonsPanel('max-h-[460px]')}
                </div>
              )}

              {!theaterMode && !isStreaming && (
              <div className="lg:hidden space-y-3">
                <div className="p-1 rounded-2xl bg-surface-container border border-outline-variant/25 grid grid-cols-3 gap-1">
                  <button
                    type="button"
                    onClick={() => setMobileTab('lessons')}
                    className={`py-2 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      mobileTab === 'lessons'
                        ? 'bg-surface-container-highest text-white shadow'
                        : 'text-outline hover:text-on-surface-variant'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      format_list_bulleted
                    </span>
                    <span>Aulas</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileTab('tutor')}
                    className={`py-2 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      mobileTab === 'tutor'
                        ? 'bg-secondary/20 text-secondary shadow'
                        : 'text-outline hover:text-secondary'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
                    <span>Tutor IA</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileTab('notes')}
                    className={`py-2 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      mobileTab === 'notes'
                        ? 'bg-surface-container-highest text-white shadow'
                        : 'text-outline hover:text-on-surface-variant'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">edit_note</span>
                    <span>Notas ({notes.length})</span>
                  </button>
                </div>

                {mobileTab === 'lessons' && (
                  <div className="rounded-2xl bg-surface-container-low border border-outline-variant/25 overflow-hidden">
                    <div className="px-4 py-3 border-b border-outline-variant/20 flex items-center justify-between text-xs">
                      <span className="font-bold text-on-surface">Conteúdo do Curso</span>
                      <span className="font-mono text-primary font-bold">
                        {course.completedLessonsCount}/{course.lessonsCount} · {course.progressPercent}%
                      </span>
                    </div>
                    <div className="max-h-[460px] overflow-y-auto">{renderCurriculumTree()}</div>
                  </div>
                )}

                {mobileTab === 'tutor' && (
                  <div className="rounded-2xl bg-surface-container-low border border-outline-variant/25 overflow-hidden h-[500px]">
                    <CourseTutorPanel
                      courseId={courseId}
                      lessonId={activeLessonId}
                      lessonTitle={activeLesson.title}
                      currentTimeSeconds={currentTime}
                    />
                  </div>
                )}
              </div>
              )}

              {/* Barra de Controles e Metadados (Desktop) */}
              <div className="hidden lg:flex rounded-2xl bg-surface-container-low border border-outline-variant/25 p-5 flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                  <div className="min-w-0">
                    <span
                      className={`text-[11px] sm:text-xs font-mono uppercase tracking-wider ${
                        isMovie
                          ? 'text-rose-300 font-bold'
                          : isSeries
                            ? 'text-fuchsia-300 font-bold'
                            : 'text-secondary'
                      }`}
                    >
                      {isMovie
                        ? course.instructorName
                          ? `FILME · ${course.instructorName}`
                          : 'FILME'
                        : activeLesson.moduleTitle}
                    </span>
                    <h2 className="text-lg sm:text-xl font-bold text-on-surface mt-0.5 break-words">
                      {isMovie ? course.title : activeLesson.title}
                    </h2>
                    {isMovie && course.description && (
                      <p className="text-xs text-slate-400 mt-1.5 leading-relaxed max-w-3xl">
                        {course.description}
                      </p>
                    )}
                  </div>

                  {!isStreaming && (
                    <button
                      onClick={handleToggleCompleted}
                      className={`w-full sm:w-auto justify-center flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border transition-all shrink-0 ${
                        activeLesson.isCompleted
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                          : 'bg-surface-container hover:bg-surface-container-high text-on-surface border-outline-variant/30'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {activeLesson.isCompleted ? 'check_circle' : 'radio_button_unchecked'}
                      </span>
                      <span>
                        {activeLesson.isCompleted ? 'Aula concluída' : 'Marcar como concluída'}
                      </span>
                    </button>
                  )}
                </div>

                {/* Controles de Velocidade, PiP e Navegação */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-outline-variant/20">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {isVideoLesson(activeLesson) && (
                      <>
                        <span className="text-[11px] font-mono text-outline mr-1">Velocidade:</span>
                        {PLAYBACK_RATES.map((rate) => (
                          <button
                            key={rate}
                            onClick={() => setPlaybackRate(rate)}
                            className={`px-2 py-1 rounded-md text-xs font-mono transition-colors ${
                              playbackRate === rate
                                ? isStreaming
                                  ? 'bg-gradient-to-r from-fuchsia-600 to-rose-600 text-white font-bold'
                                  : 'bg-primary-container text-on-primary-container font-bold'
                                : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                            }`}
                          >
                            {rate}x
                          </button>
                        ))}
                        {!isYoutubeLesson(activeLesson) && (
                          <button
                            onClick={handlePictureInPicture}
                            title="Picture-in-Picture"
                            className="ml-2 px-2.5 py-1 rounded-md bg-surface-container hover:bg-surface-container-high text-xs text-on-surface-variant flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-[15px]">
                              picture_in_picture_alt
                            </span>
                            <span>PiP</span>
                          </button>
                        )}
                      </>
                    )}

                    {!isMovie && (isVideoLesson(activeLesson) || isAudioLesson(activeLesson)) && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={autoPlay}
                        onClick={toggleAutoPlay}
                        title={
                          isSeries
                            ? 'Avançar automaticamente para o próximo episódio'
                            : 'Avançar automaticamente para a próxima aula ao finalizar'
                        }
                        className={`ml-1 px-2.5 py-1 rounded-md text-xs font-medium border flex items-center gap-2 transition-all ${
                          autoPlay
                            ? 'bg-secondary/15 text-secondary border-secondary/40'
                            : 'bg-surface-container hover:bg-surface-container-high text-on-surface-variant border-outline-variant/25'
                        }`}
                      >
                        <span
                          className={`relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors ${
                            autoPlay ? 'bg-secondary' : 'bg-outline-variant'
                          }`}
                        >
                          <span
                            className={`inline-block h-2.5 w-2.5 transform rounded-full bg-surface transition-transform ${
                              autoPlay ? 'translate-x-3' : 'translate-x-0.5'
                            }`}
                          />
                        </span>
                        <span>Autoplay</span>
                      </button>
                    )}

                    {!isMovie && (
                      <button
                        type="button"
                        onClick={toggleTheaterMode}
                        title={
                          theaterMode
                            ? 'Sair do modo teatro (Tecla T)'
                            : 'Modo teatro: expandir vídeo (Tecla T)'
                        }
                        className={`flex ml-1 px-2.5 py-1 rounded-md text-xs font-medium border items-center gap-1.5 transition-all ${
                          theaterMode
                            ? 'bg-primary/15 text-primary border-primary/40'
                            : 'bg-surface-container hover:bg-surface-container-high text-on-surface-variant border-outline-variant/25'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[15px]">
                          {theaterMode ? 'right_panel_open' : 'width_wide'}
                        </span>
                        <span>{theaterMode ? 'Sair do teatro' : 'Teatro'}</span>
                      </button>
                    )}

                    {!isYoutubeLesson(activeLesson) && activeLesson.driveFileId && (
                      <a
                        href={getDriveStreamUrl(activeLesson.driveFileId, true)}
                        className="ml-1 px-2.5 py-1 rounded-md bg-surface-container hover:bg-surface-container-high text-xs text-on-surface-variant flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[15px]">download</span>
                        <span>Baixar</span>
                      </a>
                    )}
                  </div>

                  {!isMovie && (
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <button
                        disabled={!prevLesson}
                        onClick={() => prevLesson && selectLesson(prevLesson.id)}
                        className="flex-1 sm:flex-none justify-center flex items-center gap-1 px-3 py-2 sm:py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs text-on-surface disabled:opacity-35"
                      >
                        <span className="material-symbols-outlined text-[16px]">skip_previous</span>
                        <span>Anterior</span>
                      </button>
                      <button
                        disabled={!nextLesson}
                        onClick={() => nextLesson && selectLesson(nextLesson.id, isSeries)}
                        className={`flex-1 sm:flex-none justify-center flex items-center gap-1 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-semibold disabled:opacity-35 ${
                          isSeries
                            ? 'bg-gradient-to-r from-fuchsia-600 to-rose-600 text-white'
                            : 'bg-primary-container hover:bg-secondary-container text-on-primary-container'
                        }`}
                      >
                        <span>{isSeries ? 'Próximo' : 'Próxima'}</span>
                        <span className="material-symbols-outlined text-[16px]">skip_next</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Materiais de Apoio (somente modo Curso) */}
              {!isStreaming && activeLesson.resources.length > 0 && (
                <div
                  className={`${
                    !theaterMode && mobileTab === 'notes' ? 'block' : 'hidden lg:block'
                  } rounded-2xl bg-surface-container-low border border-outline-variant/25 p-4 sm:p-5`}
                >
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
                      <span className="material-symbols-outlined text-secondary text-[18px]">
                        attach_file
                      </span>
                      <span>Materiais de apoio ({activeLesson.resources.length})</span>
                    </h3>
                    {previewResource && (
                      <button
                        type="button"
                        onClick={() => setPreviewResource(null)}
                        className="hidden lg:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-[11px] text-on-surface-variant border border-outline-variant/25 transition-colors"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                          close
                        </span>
                        <span>Fechar leitor</span>
                      </button>
                    )}
                  </div>

                  <div
                    className={
                      previewResource
                        ? 'grid grid-cols-1 lg:grid-cols-12 gap-4 items-start'
                        : ''
                    }
                  >
                    <div
                      className={
                        previewResource
                          ? 'lg:col-span-4 grid grid-cols-1 gap-2.5 lg:max-h-[620px] lg:overflow-y-auto lg:pr-1'
                          : 'grid grid-cols-1 sm:grid-cols-2 gap-3'
                      }
                    >
                      {activeLesson.resources.map((res) => {
                        const meta = getMaterialKindMeta(res);
                        const canPreview = getMaterialPreviewKind(res) !== null;
                        const isSelected = previewResource?.id === res.id;

                        return (
                          <div
                            key={res.id}
                            className={`flex items-center justify-between gap-2 p-3 rounded-xl border transition-all ${
                              isSelected
                                ? 'bg-primary/15 border-primary/50 shadow-md'
                                : 'bg-surface-container hover:bg-surface-container-high border-outline-variant/20'
                            }`}
                          >
                            <a
                              href={getDriveStreamUrl(res.driveFileId)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => {
                                if (
                                  canPreview &&
                                  typeof window !== 'undefined' &&
                                  window.innerWidth >= 1024
                                ) {
                                  e.preventDefault();
                                  setPreviewResource((prev) => (prev?.id === res.id ? null : res));
                                }
                              }}
                              className="flex items-center gap-2.5 min-w-0 flex-1"
                            >
                              <span
                                className={`material-symbols-outlined text-[20px] shrink-0 ${
                                  isSelected ? 'text-secondary' : 'text-primary'
                                }`}
                              >
                                {meta.icon}
                              </span>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-on-surface truncate">
                                  {res.title}
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5 text-[10px] font-mono text-outline uppercase">
                                  <span
                                    className={
                                      canPreview
                                        ? 'text-secondary font-semibold'
                                        : undefined
                                    }
                                  >
                                    {meta.label}
                                  </span>
                                  <span>·</span>
                                  <span>{formatBytes(res.byteSize)}</span>
                                </div>
                              </div>
                            </a>

                            <div className="flex items-center gap-1 shrink-0">
                              {canPreview && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPreviewResource((prev) =>
                                      prev?.id === res.id ? null : res,
                                    )
                                  }
                                  title={
                                    isSelected
                                      ? 'Fechar visualização ao lado'
                                      : 'Visualizar ao lado'
                                  }
                                  className={`hidden lg:flex p-1.5 rounded-lg transition-colors ${
                                    isSelected
                                      ? 'bg-secondary/20 text-secondary'
                                      : 'hover:bg-white/10 text-on-surface-variant hover:text-secondary'
                                  }`}
                                >
                                  <span
                                    className="material-symbols-outlined"
                                    style={{ fontSize: '16px' }}
                                  >
                                    {isSelected ? 'visibility_off' : 'visibility'}
                                  </span>
                                </button>
                              )}
                              <a
                                href={getDriveStreamUrl(res.driveFileId)}
                                target="_blank"
                                rel="noreferrer"
                                title="Abrir em nova aba"
                                className="p-1.5 rounded-lg hover:bg-white/10 text-outline hover:text-on-surface transition-colors"
                              >
                                <span
                                  className="material-symbols-outlined"
                                  style={{ fontSize: '16px' }}
                                >
                                  open_in_new
                                </span>
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Leitor lateral de PDF / Word / Imagem (apenas Web/Desktop, aberto somente ao clicar) */}
                    {previewResource && (
                      <div className="hidden lg:block lg:col-span-8 min-w-0">
                        <MaterialPreviewPanel
                          resource={previewResource}
                          onClose={() => setPreviewResource(null)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Anotações da Aula com Timestamp (somente modo Curso) */}
              {!isStreaming && (
              <div
                className={`${
                  !theaterMode && mobileTab === 'notes' ? 'block' : 'hidden lg:block'
                } rounded-2xl bg-surface-container-low border border-outline-variant/25 p-4 sm:p-5`}
              >
                <h3 className="text-sm font-bold text-on-surface mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-tertiary text-[18px]">
                    edit_note
                  </span>
                  <span>Anotações da aula ({notes.length})</span>
                </h3>

                <form onSubmit={handleSaveNote} className="mb-4 flex flex-col gap-2.5">
                  <textarea
                    rows={3}
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    placeholder="Escreva sua anotação em Markdown... ela ficará ancorada no minuto atual do vídeo."
                    className="w-full rounded-xl bg-surface-container-lowest border border-outline-variant/30 p-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-outline">
                      {isVideoLesson(activeLesson)
                        ? `Timestamp atual: ${formatDurationClock(currentTime)}`
                        : 'Anotação geral da aula'}
                    </span>
                    <button
                      type="submit"
                      disabled={savingNote || !noteInput.trim()}
                      className="px-4 py-2 rounded-lg bg-primary-container hover:bg-secondary-container text-on-primary-container font-semibold text-xs transition-all disabled:opacity-50"
                    >
                      {savingNote ? 'Salvando...' : 'Salvar anotação'}
                    </button>
                  </div>
                </form>

                {notes.length === 0 ? (
                  <p className="text-xs text-outline">
                    Nenhuma anotação nesta aula ainda. Clique no timestamp de uma nota salva para
                    pular direto para aquele ponto do vídeo.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {notes.map((note) => (
                      <div
                        key={note.id}
                        className="p-3.5 rounded-xl bg-surface-container border border-outline-variant/20 flex items-start justify-between gap-3"
                      >
                        <div className="space-y-1.5 min-w-0 flex-1">
                          {note.timeSeconds !== null && note.timeSeconds !== undefined && (
                            <button
                              onClick={() => jumpToTimestamp(note.timeSeconds!)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-secondary/15 text-secondary text-[11px] font-mono font-semibold hover:bg-secondary/25"
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                play_arrow
                              </span>
                              <span>{formatDurationClock(note.timeSeconds)}</span>
                            </button>
                          )}
                          <p className="text-sm text-on-surface whitespace-pre-wrap break-words">
                            {note.content}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDeleteNote(note.id)}
                          title="Excluir nota"
                          className="text-outline hover:text-error p-1"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )}
            </>
          )}
        </div>

        {/* Sidebar Desktop: Temporadas/Episódios (Série) ou Módulos/Aulas + Tutor IA (Curso). Oculta em Filmes e no Modo Teatro */}
        {!theaterMode && !isMovie && (
          <aside className="hidden lg:block lg:col-span-4 min-w-0">
            <div className="rounded-2xl bg-surface-container-low border border-outline-variant/25 overflow-hidden lg:sticky lg:top-20 flex flex-col">
              {isSeries ? (
                renderSeriesSeasonsPanel('max-h-[calc(100vh-235px)]')
              ) : (
              <>
              {/* Abas: Aulas | Tutor Gemini */}
              <div className="grid grid-cols-2 border-b border-outline-variant/20 bg-surface-container/70">
                <button
                  type="button"
                  onClick={() => setSidebarTab('lessons')}
                  className={`py-2.5 px-3 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                    sidebarTab === 'lessons'
                      ? 'border-primary text-on-surface bg-surface-container-low'
                      : 'border-transparent text-outline hover:text-on-surface-variant'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">format_list_bulleted</span>
                  <span>Aulas ({course.lessonsCount})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSidebarTab('tutor')}
                  className={`py-2.5 px-3 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                    sidebarTab === 'tutor'
                      ? 'border-secondary text-secondary bg-surface-container-low'
                      : 'border-transparent text-outline hover:text-secondary'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
                  <span>Tutor Gemini</span>
                </button>
              </div>

              {sidebarTab === 'tutor' ? (
                <div className="h-[calc(100vh-145px)]">
                  <CourseTutorPanel
                    courseId={courseId}
                    lessonId={activeLessonId}
                    lessonTitle={activeLesson?.title}
                    currentTimeSeconds={currentTime}
                  />
                </div>
              ) : (
                <>
                  <div className="p-4 border-b border-outline-variant/20 flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-bold text-on-surface">Conteúdo do Curso</h2>
                      <p className="text-[11px] text-outline font-mono mt-0.5">
                        {course.modulesCount} módulos · {course.lessonsCount} aulas
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={toggleHideCompleted}
                        title="Ocultar aulas já concluídas"
                        className={`px-2 py-1 rounded-md text-[10px] font-mono border transition-colors ${
                          hideCompleted
                            ? 'bg-secondary/15 text-secondary border-secondary/40'
                            : 'bg-surface-container text-outline border-outline-variant/25 hover:text-on-surface'
                        }`}
                      >
                        {hideCompleted ? 'Mostrando pendentes' : 'Ocultar concluídas'}
                      </button>
                      <span className="text-xs font-mono font-bold text-primary">
                        {course.progressPercent}%
                      </span>
                    </div>
                  </div>

                  <div className="max-h-[calc(100vh-225px)] overflow-y-auto">
                    {renderCurriculumTree()}
                  </div>
                </>
              )}
              </>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Drawer do Tutor Gemini (Mobile e Modo Teatro) */}
      {tutorDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm">
          <div className="w-full sm:w-[440px] max-w-full h-full bg-surface-container-low border-l border-outline-variant/30 shadow-2xl">
            <CourseTutorPanel
              courseId={courseId}
              lessonId={activeLessonId}
              lessonTitle={activeLesson?.title}
              currentTimeSeconds={currentTime}
              onClose={() => setTutorDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      <DriveFileBrowserModal
        open={fileBrowserOpen}
        courseId={courseId}
        initialFolderId={course.driveFolderId}
        initialFolderName={course.title}
        onClose={() => setFileBrowserOpen(false)}
        onFilesAttached={handleFilesAttachedFromBrowser}
        onFallbackPicker={handleAttachFilesFromPicker}
      />

      {/* Modal de Edição Manual do Curso e Capa (D1) */}
      <CourseEditModal
        course={editModalOpen ? course : null}
        onClose={() => setEditModalOpen(false)}
        onSaved={() => {
          loadCourse(true);
        }}
      />
    </div>
  );
}

export default function CoursePlayerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-3 text-outline">
          <span className="material-symbols-outlined text-4xl text-primary animate-spin">
            progress_activity
          </span>
          <p className="text-sm">Carregando player...</p>
        </div>
      }
    >
      <CoursePlayerContent />
    </Suspense>
  );
}
