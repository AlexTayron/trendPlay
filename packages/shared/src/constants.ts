export const APP_CONSTANTS = {
  APP_NAME: 'DevCore',
  DEFAULT_EMBEDDING_DIMENSION: 1536,
  RRF_K_CONSTANT: 60,
  RETRIEVAL_TOP_K: 20,
  MAX_CONTEXT_CHUNKS: 8,
  SIMILARITY_NOT_FOUND_THRESHOLD: 0.65, // Cosseno mínimo para não emitir "não encontrei"
  LESSON_COMPLETION_THRESHOLD_RATIO: 0.85, // 85% do vídeo
};

export const SUPPORTED_LANGUAGES = ['typescript', 'go', 'java'] as const;

export const OBSIDIAN_COLORS = {
  surface: '#0f131c',
  surfaceContainerLow: '#181c24',
  surfaceContainer: '#1c2028',
  surfaceContainerHigh: '#262a33',
  primary: '#adc6ff',
  primaryContainer: '#4d8eff',
  secondary: '#4cd7f6',
  tertiary: '#ffb786',
  outline: '#8c909f',
  onSurface: '#dfe2ee',
  onSurfaceVariant: '#c2c6d6',
} as const;

