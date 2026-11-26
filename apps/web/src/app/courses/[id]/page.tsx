'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type { CourseDetail, LessonDetail, LessonNote } from '@devcore/shared';
import {
  attachDriveFiles,
  createLessonNote,
  deleteLessonNote,
  getCourseDetail,
  getDriveStreamUrl,
  getLessonNotes,
  getPickerToken,
  syncDriveCourse,
  updateCourse,
  updateLessonProgress,
} from '../../../lib/api';
import { openDriveFilesPicker } from '../../../lib/google-picker';
import { DriveFileBrowserModal } from '../../../components/DriveFileBrowserModal';
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
  const router = useRouter();
  const courseId = params.id;
  const requestedLessonId = searchParams.get('lesson');

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
  const [theaterMode, setTheaterMode] = useState(false);
  const [autoPlayCountdown, setAutoPlayCountdown] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const [notes, setNotes] = useState<LessonNote[]>([]);
  const [noteInput, setNoteInput] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [liveDuration, setLiveDuration] = useState(0);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editInstructor, setEditInstructor] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytPlayerRef = useRef<YouTubePlayerHandle | null>(null);
  const shouldAutoStartRef = useRef<boolean>(false);
  const [ytAutoStart, setYtAutoStart] = useState(false);
  const lastSavedAtRef = useRef<number>(0);
  const lastReportedTimeRef = useRef<number>(0);
  const restoredForLessonRef = useRef<string | null>(null);

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
    } catch {
      // ignora
    }
  }, []);

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

  const loadCourse = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await getCourseDetail(courseId);
      setCourse(detail);
      setEditTitle(detail.title);
      setEditInstructor(detail.instructorName || '');
      setEditDescription(detail.description || '');

      const expanded: Record<string, boolean> = {};
      detail.modules.forEach((m) => {
        expanded[m.id] = true;
      });
      setExpandedModules(expanded);

      const allLessons = detail.modules.flatMap((m) => m.lessons);
      const preferred =
        (requestedLessonId && allLessons.find((l) => l.id === requestedLessonId)?.id) ||
        (detail.lastLessonId && allLessons.find((l) => l.id === detail.lastLessonId)?.id) ||
        allLessons[0]?.id ||
        null;

      setActiveLessonId((prev) =>
        prev && allLessons.some((l) => l.id === prev) ? prev : preferred,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar o curso.');
    } finally {
      setLoading(false);
    }
  }, [courseId, requestedLessonId]);

  useEffect(() => {
    loadCourse();
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

    getLessonNotes(activeLessonId)
      .then(setNotes)
      .catch(() => setNotes([]));
  }, [activeLessonId]);

  // Aplicar velocidade de reprodução
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, activeLessonId]);

  const selectLesson = useCallback(
    (lessonId: string, autoStart = false) => {
      shouldAutoStartRef.current = autoStart;
      setYtAutoStart(autoStart);
      setAutoPlayCountdown(null);
      setActiveLessonId(lessonId);
      router.replace(`/courses/${courseId}?lesson=${lessonId}`, { scroll: false });
    },
    [courseId, router],
  );

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

  const persistProgress = useCallback(
    async (
      lessonId: string,
      positionSeconds: number,
      durationSeconds: number,
      explicitCompleted?: boolean,
      watchedDeltaSeconds = 0,
    ) => {
      try {
        await updateLessonProgress(lessonId, {
          positionSeconds: Math.floor(positionSeconds),
          durationSeconds: Math.floor(durationSeconds),
          isCompleted: explicitCompleted,
          watchedDeltaSeconds: Math.floor(watchedDeltaSeconds),
        });

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
      if (savedPos > 5 && video.duration && savedPos < video.duration * 0.96) {
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

    const now = Date.now();
    if (now - lastSavedAtRef.current >= 10_000) {
      const delta = Math.max(0, Math.min(30, video.currentTime - lastReportedTimeRef.current));
      lastSavedAtRef.current = now;
      lastReportedTimeRef.current = video.currentTime;
      persistProgress(activeLesson.id, video.currentTime, video.duration || 0, undefined, delta);
    }
  };

  const handleVideoPauseOrEnd = (ended = false) => {
    const video = videoRef.current;
    if (!video || !activeLesson) return;
    const delta = Math.max(0, Math.min(30, video.currentTime - lastReportedTimeRef.current));
    lastSavedAtRef.current = Date.now();
    lastReportedTimeRef.current = video.currentTime;
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
    if (activeLesson.lastPositionSeconds > 5) {
      lastReportedTimeRef.current = activeLesson.lastPositionSeconds;
      setCurrentTime(activeLesson.lastPositionSeconds);
    }
  };

  const handleYoutubeTimeUpdate = (pos: number, dur: number) => {
    if (!activeLesson) return;
    setCurrentTime(pos);
    if (dur > 0 && Number.isFinite(dur)) {
      setLiveDuration(dur);
    }
    const now = Date.now();
    if (now - lastSavedAtRef.current >= 10_000) {
      const delta = Math.max(0, Math.min(30, pos - lastReportedTimeRef.current));
      lastSavedAtRef.current = now;
      lastReportedTimeRef.current = pos;
      persistProgress(activeLesson.id, pos, dur || activeLesson.durationSeconds, undefined, delta);
    }
  };

  const handleYoutubePause = (pos: number, dur: number) => {
    if (!activeLesson) return;
    const delta = Math.max(0, Math.min(30, pos - lastReportedTimeRef.current));
    lastSavedAtRef.current = Date.now();
    lastReportedTimeRef.current = pos;
    persistProgress(activeLesson.id, pos, dur || activeLesson.durationSeconds, undefined, delta);
  };

  const handleYoutubeEnded = (dur: number) => {
    if (!activeLesson) return;
    const finalDur = dur || activeLesson.durationSeconds;
    const delta = Math.max(0, Math.min(30, finalDur - lastReportedTimeRef.current));
    lastSavedAtRef.current = Date.now();
    lastReportedTimeRef.current = finalDur;
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
      await loadCourse();
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
      const picked = await openDriveFilesPicker(tokenInfo, course?.driveFolderId || 'root');
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
      await loadCourse();
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
    await loadCourse();
  };

  const handleSaveCourseEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEdit(true);
    try {
      await updateCourse(courseId, {
        title: editTitle,
        instructorName: editInstructor,
        description: editDescription,
      });
      setEditModalOpen(false);
      await loadCourse();
    } catch (err) {
      setStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erro ao salvar alterações do curso.',
      });
    } finally {
      setSavingEdit(false);
    }
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

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      {/* Barra Superior do Player */}
      <header className="sticky top-0 z-40 h-16 bg-surface/90 backdrop-blur-xl border-b border-outline-variant/25 px-4 sm:px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs text-on-surface-variant transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            <span className="hidden sm:inline">Biblioteca</span>
          </Link>

          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold text-on-surface truncate">
              {course.title}
            </h1>
            <div className="flex items-center gap-2 text-[11px] font-mono text-outline">
              <span>{course.progressPercent}% concluído</span>
              <span>·</span>
              <span>
                {course.completedLessonsCount}/{course.lessonsCount} aulas
              </span>
              {course.totalDurationSeconds > 0 && (
                <>
                  <span>·</span>
                  <span>{formatWatchTime(course.totalDurationSeconds)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isYoutubeCourse && (
            <button
              onClick={() => setFileBrowserOpen(true)}
              disabled={attaching}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/15 hover:bg-secondary/25 text-secondary border border-secondary/30 text-xs font-semibold transition-all disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">add_to_drive</span>
              <span className="hidden md:inline">
                {attaching ? 'Carregando...' : 'Adicionar arquivos'}
              </span>
            </button>
          )}

          <button
            onClick={toggleTheaterMode}
            title={theaterMode ? 'Mostrar lista de aulas (Tecla T)' : 'Modo teatro: recolher lista de aulas (Tecla T)'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              theaterMode
                ? 'bg-primary/15 text-primary border-primary/40 hover:bg-primary/25'
                : 'bg-surface-container hover:bg-surface-container-high border-outline-variant/30 text-on-surface-variant'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">
              {theaterMode ? 'right_panel_open' : 'width_wide'}
            </span>
            <span className="hidden md:inline">
              {theaterMode ? 'Mostrar aulas' : 'Teatro'}
            </span>
          </button>

          <button
            onClick={handleSyncCourse}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-xs text-on-surface transition-colors disabled:opacity-50"
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
            title="Editar metadados do curso"
            className="p-2 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-on-surface-variant"
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

      {/* Workspace Principal: Player (Esquerda) + Grade de Módulos/Aulas (Direita) */}
      <div
        className={`flex-1 w-full mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 transition-all ${
          theaterMode ? 'max-w-[1920px]' : 'max-w-[1700px]'
        }`}
      >
        {/* Área do Player + Materiais + Notas */}
        <div
          className={`${theaterMode ? 'lg:col-span-12' : 'lg:col-span-8'} flex flex-col gap-6 transition-all`}
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
              {/* Container de Mídia */}
              <div className="relative rounded-2xl overflow-hidden bg-black border border-outline-variant/25 shadow-2xl">
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
                      className="w-full h-[600px] border-0 bg-white"
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

              {/* Barra de Controles e Metadados da Aula */}
              <div className="rounded-2xl bg-surface-container-low border border-outline-variant/25 p-5 flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <span className="text-xs font-mono text-secondary uppercase tracking-wider">
                      {activeLesson.moduleTitle}
                    </span>
                    <h2 className="text-xl font-bold text-on-surface mt-0.5">
                      {activeLesson.title}
                    </h2>
                  </div>

                  <button
                    onClick={handleToggleCompleted}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border transition-all shrink-0 ${
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
                                ? 'bg-primary-container text-on-primary-container font-bold'
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

                    {(isVideoLesson(activeLesson) || isAudioLesson(activeLesson)) && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={autoPlay}
                        onClick={toggleAutoPlay}
                        title="Avançar automaticamente para a próxima aula ao finalizar"
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

                    <button
                      type="button"
                      onClick={toggleTheaterMode}
                      title={
                        theaterMode
                          ? 'Sair do modo teatro e mostrar aulas (Tecla T)'
                          : 'Modo teatro: expandir vídeo e recolher próximos títulos (Tecla T)'
                      }
                      className={`ml-1 px-2.5 py-1 rounded-md text-xs font-medium border flex items-center gap-1.5 transition-all ${
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

                    {isYoutubeLesson(activeLesson) && getYoutubeVideoId(activeLesson) ? (
                      <a
                        href={`https://www.youtube.com/watch?v=${getYoutubeVideoId(activeLesson)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-1 px-2.5 py-1 rounded-md bg-surface-container hover:bg-surface-container-high text-xs text-on-surface-variant flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[15px] text-red-400">
                          smart_display
                        </span>
                        <span>Abrir no YouTube</span>
                      </a>
                    ) : (
                      activeLesson.driveFileId && (
                        <a
                          href={getDriveStreamUrl(activeLesson.driveFileId, true)}
                          className="ml-1 px-2.5 py-1 rounded-md bg-surface-container hover:bg-surface-container-high text-xs text-on-surface-variant flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[15px]">download</span>
                          <span>Baixar</span>
                        </a>
                      )
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      disabled={!prevLesson}
                      onClick={() => prevLesson && selectLesson(prevLesson.id)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs text-on-surface disabled:opacity-35"
                    >
                      <span className="material-symbols-outlined text-[16px]">skip_previous</span>
                      <span>Anterior</span>
                    </button>
                    <button
                      disabled={!nextLesson}
                      onClick={() => nextLesson && selectLesson(nextLesson.id)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary-container hover:bg-secondary-container text-xs font-semibold text-on-primary-container disabled:opacity-35"
                    >
                      <span>Próxima</span>
                      <span className="material-symbols-outlined text-[16px]">skip_next</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Materiais de Apoio da Aula */}
              {activeLesson.resources.length > 0 && (
                <div className="rounded-2xl bg-surface-container-low border border-outline-variant/25 p-5">
                  <h3 className="text-sm font-bold text-on-surface mb-3 flex items-center gap-2">
                    <span className="material-symbols-outlined text-secondary text-[18px]">
                      attach_file
                    </span>
                    <span>Materiais de apoio ({activeLesson.resources.length})</span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {activeLesson.resources.map((res) => (
                      <a
                        key={res.id}
                        href={getDriveStreamUrl(res.driveFileId)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-container hover:bg-surface-container-high border border-outline-variant/20 transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="material-symbols-outlined text-primary text-[20px]">
                            {res.role === 'code'
                              ? 'code'
                              : res.role === 'transcript'
                                ? 'subtitles'
                                : 'description'}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-on-surface truncate">
                              {res.title}
                            </div>
                            <div className="text-[10px] font-mono text-outline uppercase">
                              {res.role} · {formatBytes(res.byteSize)}
                            </div>
                          </div>
                        </div>
                        <span className="material-symbols-outlined text-[16px] text-outline">
                          open_in_new
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Anotações da Aula com Timestamp */}
              <div className="rounded-2xl bg-surface-container-low border border-outline-variant/25 p-5">
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
            </>
          )}
        </div>

        {/* Sidebar de Conteúdo (Módulos e Aulas) — recolhida no Modo Teatro */}
        {!theaterMode && (
          <aside className="lg:col-span-4">
            <div className="rounded-2xl bg-surface-container-low border border-outline-variant/25 overflow-hidden sticky top-20">
              <div className="p-4 border-b border-outline-variant/20 flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-on-surface">Conteúdo do Curso</h2>
                  <p className="text-[11px] text-outline font-mono mt-0.5">
                    {course.modulesCount} módulos · {course.lessonsCount} aulas
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-primary">
                    {course.progressPercent}%
                  </span>
                  <button
                    type="button"
                    onClick={toggleTheaterMode}
                    title="Recolher lista (Modo Teatro · Tecla T)"
                    className="p-1 rounded-md text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      right_panel_close
                    </span>
                  </button>
                </div>
              </div>

            <div className="max-h-[calc(100vh-180px)] overflow-y-auto divide-y divide-outline-variant/15">
              {course.modules.map((mod) => {
                const isOpen = expandedModules[mod.id] ?? true;
                const completedInMod = mod.lessons.filter((l) => l.isCompleted).length;
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
                        {mod.lessons.map((lesson) => {
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
          </div>
        </aside>
        )}
      </div>

      <DriveFileBrowserModal
        open={fileBrowserOpen}
        courseId={courseId}
        initialFolderId={course.driveFolderId}
        initialFolderName={course.title}
        onClose={() => setFileBrowserOpen(false)}
        onFilesAttached={handleFilesAttachedFromBrowser}
        onFallbackPicker={handleAttachFilesFromPicker}
      />

      {/* Modal de Edição Manual do Curso (D1) */}
      {editModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveCourseEdit}
            className="w-full max-w-lg rounded-2xl bg-surface-container-low border border-outline-variant/30 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-on-surface">Editar informações do curso</h2>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="text-outline hover:text-on-surface"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Título</label>
              <input
                type="text"
                required
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant/30 px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-xs text-on-surface-variant mb-1">
                Instrutor (opcional)
              </label>
              <input
                type="text"
                value={editInstructor}
                onChange={(e) => setEditInstructor(e.target.value)}
                placeholder="Ex.: Rodrigo Branas"
                className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant/30 px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Descrição</label>
              <textarea
                rows={3}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant/30 px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-surface-container text-xs text-on-surface-variant"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="px-4 py-2 rounded-lg bg-primary-container text-on-primary-container font-semibold text-xs"
              >
                {savingEdit ? 'Salvando...' : 'Salvar alterações'}
              </button>
            </div>
          </form>
        </div>
      )}
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
