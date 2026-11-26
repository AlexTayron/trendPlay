export function formatDurationClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function formatWatchTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function getInitials(fullName?: string | null): string {
  if (!fullName) return 'DC';
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first) return 'DC';
  if (parts.length === 1 || !last) return first.slice(0, 2).toUpperCase();
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

export function getFirstName(fullName?: string | null): string {
  if (!fullName) return 'Dev';
  return fullName.trim().split(/\s+/)[0] || 'Dev';
}

export function getGreetingPtBr(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function getFormattedDatePtBr(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
    .format(new Date())
    .toUpperCase();
}
