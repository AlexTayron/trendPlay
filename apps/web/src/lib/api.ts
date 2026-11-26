import type {
  AuthConfigStatus,
  CourseDetail,
  CourseSummary,
  DashboardOverview,
  DriveFolderListResponse,
  DriveItemsListResponse,
  ImportDriveFolderResult,
  ImportRootFolderResult,
  LessonNote,
  PickerTokenResponse,
} from '@devcore/shared';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
    cache: 'no-store',
  });

  if (!res.ok) {
    let message = `Erro na requisição (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data?.message === 'string') {
        message = data.message;
      } else if (Array.isArray(data?.message)) {
        message = data.message.join(', ');
      }
    } catch {
      // mantém mensagem padrão
    }
    throw new ApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export function getGoogleAuthUrl(): string {
  return `${API_BASE_URL}/auth/google`;
}

export function getDriveStreamUrl(driveFileId: string, download = false): string {
  const suffix = download ? '?download=1' : '';
  return `${API_BASE_URL}/drive/files/${encodeURIComponent(driveFileId)}/stream${suffix}`;
}

export function getAuthConfig(): Promise<AuthConfigStatus> {
  return apiFetch<AuthConfigStatus>('/auth/config');
}

export function logout(): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>('/auth/logout', { method: 'POST' });
}

export function getDashboard(): Promise<DashboardOverview> {
  return apiFetch<DashboardOverview>('/learning/dashboard');
}

export function getCourseDetail(courseId: string): Promise<CourseDetail> {
  return apiFetch<CourseDetail>(`/learning/courses/${encodeURIComponent(courseId)}`);
}

export function updateCourse(
  courseId: string,
  payload: { title?: string; description?: string; instructorName?: string },
): Promise<CourseSummary> {
  return apiFetch<CourseSummary>(`/learning/courses/${encodeURIComponent(courseId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function archiveCourse(courseId: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/learning/courses/${encodeURIComponent(courseId)}`, {
    method: 'DELETE',
  });
}

export function getPickerToken(): Promise<PickerTokenResponse> {
  return apiFetch<PickerTokenResponse>('/drive/picker-token');
}

export function listDriveFolders(parentId = 'root'): Promise<DriveFolderListResponse> {
  return apiFetch<DriveFolderListResponse>(
    `/drive/folders?parentId=${encodeURIComponent(parentId)}`,
  );
}

export function listDriveItems(parentId = 'root'): Promise<DriveItemsListResponse> {
  return apiFetch<DriveItemsListResponse>(
    `/drive/items?parentId=${encodeURIComponent(parentId)}`,
  );
}

export function importDriveFolder(payload: {
  folderId: string;
  folderName?: string;
  selectedFiles?: Array<{ id: string; name: string; mimeType?: string }>;
}): Promise<ImportDriveFolderResult> {
  return apiFetch<ImportDriveFolderResult>('/drive/courses/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function importRootCoursesFolder(
  folderId: string,
): Promise<ImportRootFolderResult> {
  return apiFetch<ImportRootFolderResult>('/drive/courses/import-root', {
    method: 'POST',
    body: JSON.stringify({ folderId }),
  });
}

export function syncDriveCourse(courseId: string): Promise<ImportDriveFolderResult> {
  return apiFetch<ImportDriveFolderResult>(
    `/drive/courses/${encodeURIComponent(courseId)}/sync`,
    { method: 'POST' },
  );
}

export function importYoutubePlaylist(payload: {
  playlistUrl: string;
  customTitle?: string;
}): Promise<ImportDriveFolderResult> {
  return apiFetch<ImportDriveFolderResult>('/youtube/playlists/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function attachDriveFiles(
  courseId: string,
  payload: {
    moduleTitle?: string;
    files: Array<{ id: string; name: string; mimeType?: string }>;
  },
): Promise<{ addedLessons: number; addedDocuments: number }> {
  return apiFetch<{ addedLessons: number; addedDocuments: number }>(
    `/drive/courses/${encodeURIComponent(courseId)}/attach-files`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

export function disconnectDrive(): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>('/drive/disconnect', { method: 'DELETE' });
}

export function getLessonNotes(lessonId: string): Promise<LessonNote[]> {
  return apiFetch<LessonNote[]>(`/learning/lessons/${encodeURIComponent(lessonId)}/notes`);
}

export function createLessonNote(
  lessonId: string,
  payload: { content: string; timeSeconds?: number },
): Promise<LessonNote> {
  return apiFetch<LessonNote>(`/learning/lessons/${encodeURIComponent(lessonId)}/notes`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteLessonNote(
  lessonId: string,
  noteId: string,
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(
    `/learning/lessons/${encodeURIComponent(lessonId)}/notes/${encodeURIComponent(noteId)}`,
    { method: 'DELETE' },
  );
}

export function updateLessonProgress(
  lessonId: string,
  payload: {
    positionSeconds: number;
    durationSeconds: number;
    isCompleted?: boolean;
    watchedDeltaSeconds?: number;
  },
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(
    `/learning/lessons/${encodeURIComponent(lessonId)}/progress`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  );
}
