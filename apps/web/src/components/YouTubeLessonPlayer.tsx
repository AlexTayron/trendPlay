'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { formatDurationClock } from '../lib/format';

export interface YouTubePlayerHandle {
  seekTo: (seconds: number) => void;
  syncPosition: (seconds: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  isPlaying: () => boolean;
  play: () => void;
  pause: () => void;
}

interface YTPlayerInstance {
  destroy(): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
  getPlayerState(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setVolume(volume: number): void;
  getVolume(): number;
}

interface YTNamespace {
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: { target: YTPlayerInstance }) => void;
        onStateChange?: (event: { target: YTPlayerInstance; data: number }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayerInstance;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube IFrame API só roda no navegador.'));
  }

  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (ytApiPromise) {
    return ytApiPromise;
  }

  ytApiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevReady?.();
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error('YouTube IFrame API não inicializou corretamente.'));
      }
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (!existing) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        ytApiPromise = null;
        reject(new Error('Falha ao carregar o player do YouTube.'));
      };
      document.body.appendChild(script);
    }
  });

  return ytApiPromise;
}

interface YouTubeLessonPlayerProps {
  videoId: string;
  initialPositionSeconds?: number;
  playbackRate: number;
  autoStart?: boolean;
  className?: string;
  onReady?: (durationSeconds: number) => void;
  onTimeUpdate?: (currentSeconds: number, durationSeconds: number) => void;
  onPause?: (currentSeconds: number, durationSeconds: number) => void;
  onEnded?: (durationSeconds: number) => void;
}

export const YouTubeLessonPlayer = forwardRef<YouTubePlayerHandle, YouTubeLessonPlayerProps>(
  function YouTubeLessonPlayer(
    {
      videoId,
      initialPositionSeconds = 0,
      playbackRate,
      autoStart = false,
      className = 'w-full aspect-video bg-black',
      onReady,
      onTimeUpdate,
      onPause,
      onEnded,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const hostRef = useRef<HTMLDivElement | null>(null);
    const playerRef = useRef<YTPlayerInstance | null>(null);
    const rateRef = useRef(playbackRate);
    rateRef.current = playbackRate;

    const callbacksRef = useRef({ onReady, onTimeUpdate, onPause, onEnded });
    callbacksRef.current = { onReady, onTimeUpdate, onPause, onEnded };

    const [ready, setReady] = useState(false);
    const [hasStarted, setHasStarted] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [buffering, setBuffering] = useState(false);
    const [embedBlocked, setEmbedBlocked] = useState(false);
    const [posterSrc, setPosterSrc] = useState(
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    );
    const [currentSec, setCurrentSec] = useState(initialPositionSeconds || 0);
    const [durationSec, setDurationSec] = useState(0);
    const [muted, setMuted] = useState(false);
    const [volume, setVolume] = useState(100);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [controlsVisible, setControlsVisible] = useState(true);
    const hideTimerRef = useRef<number | null>(null);
    const playingRef = useRef(false);
    const currentSecRef = useRef(initialPositionSeconds || 0);
    const durationSecRef = useRef(0);
    playingRef.current = playing;
    currentSecRef.current = currentSec;
    durationSecRef.current = durationSec;

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        try {
          playerRef.current?.seekTo(seconds, true);
          playerRef.current?.playVideo();
          setCurrentSec(seconds);
          currentSecRef.current = seconds;
        } catch {
          // ignora se player ainda estiver montando
        }
      },
      syncPosition: (seconds: number) => {
        try {
          playerRef.current?.seekTo(seconds, true);
          setCurrentSec(seconds);
          currentSecRef.current = seconds;
        } catch {
          // ignora se player ainda estiver montando
        }
      },
      getCurrentTime: () => {
        try {
          return playerRef.current?.getCurrentTime() || currentSecRef.current;
        } catch {
          return currentSecRef.current;
        }
      },
      getDuration: () => {
        try {
          return playerRef.current?.getDuration() || durationSecRef.current;
        } catch {
          return durationSecRef.current;
        }
      },
      isPlaying: () => playingRef.current,
      play: () => {
        try {
          playerRef.current?.playVideo();
        } catch {
          // ignora
        }
      },
      pause: () => {
        try {
          playerRef.current?.pauseVideo();
        } catch {
          // ignora
        }
      },
    }));

    // Sincronizar velocidade quando o usuário clicar em 0.75x..2x
    useEffect(() => {
      try {
        playerRef.current?.setPlaybackRate(playbackRate);
      } catch {
        // ignora se player não estiver pronto
      }
    }, [playbackRate]);

    useEffect(() => {
      const handleFsChange = () => {
        setIsFullscreen(Boolean(document.fullscreenElement));
      };
      document.addEventListener('fullscreenchange', handleFsChange);
      return () => document.removeEventListener('fullscreenchange', handleFsChange);
    }, []);

    const bumpControlsVisibility = useCallback(() => {
      setControlsVisible(true);
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
      hideTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, 2800);
    }, []);

    useEffect(() => {
      return () => {
        if (hideTimerRef.current !== null) {
          window.clearTimeout(hideTimerRef.current);
        }
      };
    }, []);

    useEffect(() => {
      let cancelled = false;
      let pollId: number | null = null;
      const host = hostRef.current;
      if (!host) return;

      setReady(false);
      setHasStarted(false);
      setPlaying(false);
      setBuffering(false);
      setEmbedBlocked(false);
      setPosterSrc(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`);
      setCurrentSec(initialPositionSeconds || 0);
      setDurationSec(0);
      setControlsVisible(true);

      const mountTarget = document.createElement('div');
      mountTarget.style.width = '100%';
      mountTarget.style.height = '100%';
      host.innerHTML = '';
      host.appendChild(mountTarget);

      const stopPolling = () => {
        if (pollId !== null) {
          window.clearInterval(pollId);
          pollId = null;
        }
      };

      loadYouTubeIframeApi()
        .then((YT) => {
          if (cancelled) return;

          const startSec = initialPositionSeconds >= 1 ? Math.floor(initialPositionSeconds) : 0;

          const player = new YT.Player(mountTarget, {
            videoId,
            width: '100%',
            height: '100%',
            playerVars: {
              autoplay: autoStart ? 1 : 0,
              controls: 0,
              disablekb: 1,
              fs: 0,
              iv_load_policy: 3,
              rel: 0,
              modestbranding: 1,
              playsinline: 1,
              start: startSec,
              origin: window.location.origin,
            },
            events: {
              onReady: ({ target }) => {
                if (cancelled) return;
                setReady(true);
                try {
                  target.setPlaybackRate(rateRef.current);
                  const dur = target.getDuration() || 0;
                  setDurationSec(dur);
                  setMuted(target.isMuted());
                  setVolume(target.getVolume() ?? 100);
                  callbacksRef.current.onReady?.(dur);
                  if (autoStart) {
                    target.playVideo();
                  }
                } catch {
                  // ignora
                }
              },
              onError: ({ data }) => {
                if (cancelled) return;
                if (data === 101 || data === 150) {
                  setEmbedBlocked(true);
                }
              },
              onStateChange: ({ target, data }) => {
                if (cancelled) return;
                if (data === YT.PlayerState.PLAYING) {
                  setHasStarted(true);
                  setPlaying(true);
                  setBuffering(false);
                  bumpControlsVisibility();
                  try {
                    target.setPlaybackRate(rateRef.current);
                  } catch {
                    // ignora
                  }
                  stopPolling();
                  pollId = window.setInterval(() => {
                    try {
                      const t = target.getCurrentTime() || 0;
                      const d = target.getDuration() || 0;
                      setCurrentSec(t);
                      if (d > 0) setDurationSec(d);
                      callbacksRef.current.onTimeUpdate?.(t, d);
                    } catch {
                      // ignora
                    }
                  }, 500);
                } else if (data === YT.PlayerState.BUFFERING) {
                  setBuffering(true);
                } else if (data === YT.PlayerState.PAUSED) {
                  setPlaying(false);
                  setBuffering(false);
                  setControlsVisible(true);
                  stopPolling();
                  try {
                    const t = target.getCurrentTime() || 0;
                    const d = target.getDuration() || 0;
                    setCurrentSec(t);
                    if (d > 0) setDurationSec(d);
                    callbacksRef.current.onPause?.(t, d);
                  } catch {
                    // ignora
                  }
                } else if (data === YT.PlayerState.ENDED) {
                  setPlaying(false);
                  setBuffering(false);
                  setControlsVisible(true);
                  stopPolling();
                  try {
                    const d = target.getDuration() || 0;
                    if (d > 0) {
                      setCurrentSec(d);
                      setDurationSec(d);
                    }
                    callbacksRef.current.onEnded?.(d);
                  } catch {
                    // ignora
                  }
                } else {
                  setBuffering(false);
                  stopPolling();
                }
              },
            },
          });

          playerRef.current = player;
        })
        .catch(() => {
          // fallback silencioso
        });

      return () => {
        cancelled = true;
        stopPolling();
        try {
          playerRef.current?.destroy();
        } catch {
          // ignora
        }
        playerRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoId]);

    const handleTogglePlay = () => {
      const player = playerRef.current;
      if (!player || !ready) return;
      bumpControlsVisibility();
      if (playing) {
        player.pauseVideo();
      } else {
        player.playVideo();
      }
    };

    const handleSkip = (deltaSec: number) => {
      const player = playerRef.current;
      if (!player || !ready) return;
      bumpControlsVisibility();
      const target = Math.max(0, Math.min(durationSec || 999999, currentSec + deltaSec));
      player.seekTo(target, true);
      setCurrentSec(target);
    };

    const handleSeekInput = (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextSec = Number(e.target.value);
      setCurrentSec(nextSec);
      try {
        playerRef.current?.seekTo(nextSec, true);
      } catch {
        // ignora
      }
      bumpControlsVisibility();
    };

    const handleToggleMute = () => {
      const player = playerRef.current;
      if (!player) return;
      if (muted) {
        player.unMute();
        setMuted(false);
      } else {
        player.mute();
        setMuted(true);
      }
      bumpControlsVisibility();
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextVol = Number(e.target.value);
      setVolume(nextVol);
      try {
        playerRef.current?.setVolume(nextVol);
        if (nextVol === 0) {
          playerRef.current?.mute();
          setMuted(true);
        } else if (muted) {
          playerRef.current?.unMute();
          setMuted(false);
        }
      } catch {
        // ignora
      }
    };

    const handleToggleFullscreen = async () => {
      const el = containerRef.current;
      if (!el) return;
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else {
          await el.requestFullscreen();
        }
      } catch {
        // ignora se navegador bloquear
      }
    };

    const progressPercent = durationSec > 0 ? Math.min(100, (currentSec / durationSec) * 100) : 0;
    const showChrome = !playing || controlsVisible;

    return (
      <div
        ref={containerRef}
        onMouseMove={bumpControlsVisibility}
        onTouchStart={bumpControlsVisibility}
        className={`relative select-none overflow-hidden ${className}`}
      >
        {/* Iframe YouTube sem controles nativos */}
        <div ref={hostRef} className="w-full h-full pointer-events-none" />

        {/* Capa limpa antes do primeiro Play (remove completamente título/avatar/marca d'água do YouTube) */}
        {!embedBlocked && !hasStarted && (
          <div className="absolute inset-0 z-[5] bg-[#080c14] pointer-events-none">
            <img
              src={posterSrc}
              alt="Capa da aula"
              onError={() => {
                if (!posterSrc.endsWith('hqdefault.jpg')) {
                  setPosterSrc(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
                }
              }}
              className="w-full h-full object-cover opacity-85"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#080c14] via-black/25 to-[#080c14]/55" />
          </div>
        )}

        {/* Faixa superior opaca quando pausado após iniciar (cobre o título/avatar nativo que o YouTube exibe na pausa) */}
        {!embedBlocked && hasStarted && !playing && (
          <div className="absolute inset-x-0 top-0 z-[15] h-16 sm:h-[72px] bg-[#0b1019] border-b border-outline-variant/15 px-4 flex items-center justify-between pointer-events-none">
            <div className="flex items-center gap-2 text-xs text-on-surface-variant">
              <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
              <span className="font-semibold text-white">Pausado</span>
              <span className="font-mono text-[11px] text-outline">
                {formatDurationClock(currentSec)} / {formatDurationClock(durationSec)}
              </span>
            </div>
            <span className="text-[11px] text-outline hidden sm:inline">
              Clique no vídeo para retomar
            </span>
          </div>
        )}

        {/* Camada de aviso caso o criador tenha desativado incorporação */}
        {embedBlocked ? (
          <div className="absolute inset-0 bg-[#0b1019]/95 flex flex-col items-center justify-center p-6 text-center z-20">
            <span className="material-symbols-outlined text-4xl text-amber-300 mb-2">
              videocam_off
            </span>
            <h3 className="text-sm sm:text-base font-bold text-white">
              Incorporação desativada pelo dono deste vídeo
            </h3>
            <p className="text-xs text-slate-400 max-w-md mt-1">
              O canal proprietário bloqueou a reprodução fora do YouTube. Você pode continuar usando
              o Tutor IA e suas anotações normalmente nesta aula.
            </p>
          </div>
        ) : (
          <>
            {/* Área clicável para Play / Pause com botão central da plataforma DevCore */}
            <button
              type="button"
              onClick={handleTogglePlay}
              aria-label={playing ? 'Pausar vídeo' : 'Reproduzir vídeo'}
              className="absolute inset-0 z-10 flex items-center justify-center bg-transparent focus:outline-none"
            >
              {buffering ? (
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#0b1019]/85 backdrop-blur-md border border-secondary/40 flex items-center justify-center shadow-2xl">
                  <span
                    className="material-symbols-outlined text-secondary animate-spin"
                    style={{ fontSize: '36px' }}
                  >
                    progress_activity
                  </span>
                </div>
              ) : !playing ? (
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-primary-container hover:bg-secondary-container text-on-primary-container flex items-center justify-center shadow-2xl ring-4 ring-primary/30 transition-transform hover:scale-105">
                  <span
                    className="material-symbols-outlined ml-1"
                    style={{ fontVariationSettings: "'FILL' 1", fontSize: '42px' }}
                  >
                    play_arrow
                  </span>
                </div>
              ) : null}
            </button>

            {/* Barra inferior opaca de controles própria da plataforma (cobre completamente a barra/marca d'água inferior do YouTube) */}
            <div
              className={`absolute inset-x-0 bottom-0 z-20 transition-opacity duration-200 ${
                showChrome ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              <div className="h-6 bg-gradient-to-t from-[#0b1019] to-transparent pointer-events-none" />
              <div className="bg-[#0b1019] border-t border-white/5 px-3 sm:px-4 pt-2 pb-2.5 sm:pb-3">
                {/* Barra de progresso / seek */}
                <div className="relative flex items-center mb-2.5 group">
                  <div className="w-full h-1.5 rounded-full bg-white/15 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary-container to-secondary"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={durationSec || 100}
                    step={1}
                    value={Math.min(currentSec, durationSec || 100)}
                    onChange={handleSeekInput}
                    aria-label="Posição do vídeo"
                    className="absolute inset-0 w-full h-5 -top-1.5 opacity-0 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between gap-2 text-white">
                  <div className="flex items-center gap-1 sm:gap-2">
                    <button
                      type="button"
                      onClick={handleTogglePlay}
                      title={playing ? 'Pausar' : 'Reproduzir'}
                      className="w-8 h-8 rounded-lg bg-primary-container hover:bg-secondary-container text-on-primary-container flex items-center justify-center transition-colors"
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontVariationSettings: "'FILL' 1", fontSize: '20px' }}
                      >
                        {playing ? 'pause' : 'play_arrow'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSkip(-10)}
                      title="Voltar 10 segundos"
                      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-200 transition-colors"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '19px' }}>
                        replay_10
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSkip(10)}
                      title="Avançar 10 segundos"
                      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-200 transition-colors"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '19px' }}>
                        forward_10
                      </span>
                    </button>

                    <span className="ml-1 text-[11px] sm:text-xs font-mono text-slate-200 tabular-nums">
                      {formatDurationClock(currentSec)} / {formatDurationClock(durationSec)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <button
                      type="button"
                      onClick={handleToggleMute}
                      title={muted ? 'Ativar som' : 'Silenciar'}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-200 transition-colors"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '19px' }}>
                        {muted || volume === 0 ? 'volume_off' : 'volume_up'}
                      </span>
                    </button>

                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={muted ? 0 : volume}
                      onChange={handleVolumeChange}
                      aria-label="Volume"
                      className="hidden sm:block w-16 accent-primary-container cursor-pointer"
                    />

                    <button
                      type="button"
                      onClick={handleToggleFullscreen}
                      title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-200 transition-colors"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '19px' }}>
                        {isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  },
);
