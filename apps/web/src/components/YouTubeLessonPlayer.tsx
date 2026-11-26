'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface YouTubePlayerHandle {
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  play: () => void;
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
    const hostRef = useRef<HTMLDivElement | null>(null);
    const playerRef = useRef<YTPlayerInstance | null>(null);
    const rateRef = useRef(playbackRate);
    rateRef.current = playbackRate;

    const callbacksRef = useRef({ onReady, onTimeUpdate, onPause, onEnded });
    callbacksRef.current = { onReady, onTimeUpdate, onPause, onEnded };

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        try {
          playerRef.current?.seekTo(seconds, true);
          playerRef.current?.playVideo();
        } catch {
          // ignora se player ainda estiver montando
        }
      },
      getCurrentTime: () => {
        try {
          return playerRef.current?.getCurrentTime() || 0;
        } catch {
          return 0;
        }
      },
      getDuration: () => {
        try {
          return playerRef.current?.getDuration() || 0;
        } catch {
          return 0;
        }
      },
      play: () => {
        try {
          playerRef.current?.playVideo();
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
      let cancelled = false;
      let pollId: number | null = null;
      const host = hostRef.current;
      if (!host) return;

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

          const startSec = initialPositionSeconds > 5 ? Math.floor(initialPositionSeconds) : 0;

          const player = new YT.Player(mountTarget, {
            videoId,
            width: '100%',
            height: '100%',
            playerVars: {
              autoplay: autoStart ? 1 : 0,
              rel: 0,
              modestbranding: 1,
              playsinline: 1,
              start: startSec,
              origin: window.location.origin,
            },
            events: {
              onReady: ({ target }) => {
                if (cancelled) return;
                try {
                  target.setPlaybackRate(rateRef.current);
                  const dur = target.getDuration() || 0;
                  callbacksRef.current.onReady?.(dur);
                  if (autoStart) {
                    target.playVideo();
                  }
                } catch {
                  // ignora
                }
              },
              onStateChange: ({ target, data }) => {
                if (cancelled) return;
                if (data === YT.PlayerState.PLAYING) {
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
                      callbacksRef.current.onTimeUpdate?.(t, d);
                    } catch {
                      // ignora
                    }
                  }, 500);
                } else if (data === YT.PlayerState.PAUSED) {
                  stopPolling();
                  try {
                    const t = target.getCurrentTime() || 0;
                    const d = target.getDuration() || 0;
                    callbacksRef.current.onPause?.(t, d);
                  } catch {
                    // ignora
                  }
                } else if (data === YT.PlayerState.ENDED) {
                  stopPolling();
                  try {
                    const d = target.getDuration() || 0;
                    callbacksRef.current.onEnded?.(d);
                  } catch {
                    // ignora
                  }
                } else {
                  stopPolling();
                }
              },
            },
          });

          playerRef.current = player;
        })
        .catch(() => {
          // fallback silencioso se script falhar
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

    return <div ref={hostRef} className={className} />;
  },
);
