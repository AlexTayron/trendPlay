import { DocumentLocator } from './locators.js';

export type UserRole = 'student' | 'engineer' | 'admin';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  githubHandle?: string | null;
  linkedinUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoogleDriveSource {
  id: string;
  userId: string;
  driveFileId: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  parentDriveId?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Course {
  id: string;
  userId: string;
  driveSourceId?: string | null;
  title: string;
  description?: string | null;
  instructorName?: string | null;
  thumbnailUrl?: string | null;
  totalHours: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Module {
  id: string;
  userId: string;
  courseId: string;
  title: string;
  orderIndex: number;
  createdAt: string;
}

export interface Lesson {
  id: string;
  userId: string;
  moduleId: string;
  title: string;
  orderIndex: number;
  durationSeconds: number;
  mediaSourceId?: string | null;
  mediaDriveId?: string | null;
  createdAt: string;
}

export interface DriveConnectionStatus {
  connected: boolean;
  status: 'active' | 'revoked' | 'expired' | 'disconnected';
  scope?: string | null;
  expiresAt?: string | null;
  lastSyncedAt?: string | null;
  syncStatus?: 'idle' | 'syncing' | 'error';
  errorMessage?: string | null;
}

export interface PickerTokenResponse {
  accessToken: string;
  expiresAt: string;
  apiKey: string;
  appId?: string | null;
  clientId: string;
}

export interface LessonResource {
  id: string;
  documentId: string;
  driveFileId: string;
  title: string;
  mimeType: string;
  role: 'transcript' | 'resource' | 'code';
  byteSize: number;
}

export interface LessonDetail extends Lesson {
  mimeType?: string | null;
  driveFileId?: string | null;
  lastPositionSeconds: number;
  isCompleted: boolean;
  resources: LessonResource[];
}

export interface ModuleWithLessons extends Module {
  driveSourceId?: string | null;
  driveFolderId?: string | null;
  lessons: LessonDetail[];
}

export interface CourseSummary extends Course {
  sourceType?: 'drive' | 'youtube';
  driveFolderId?: string | null;
  modulesCount: number;
  lessonsCount: number;
  completedLessonsCount: number;
  progressPercent: number;
  totalDurationSeconds: number;
  watchedSeconds: number;
  lastLessonId?: string | null;
  lastLessonTitle?: string | null;
  lastModuleTitle?: string | null;
}

export interface CourseDetail extends CourseSummary {
  modules: ModuleWithLessons[];
}

export interface ContinueWatchingItem {
  courseId: string;
  courseTitle: string;
  instructorName?: string | null;
  moduleTitle: string;
  lessonId: string;
  lessonTitle: string;
  durationSeconds: number;
  lastPositionSeconds: number;
  totalCourseSeconds: number;
  watchedCourseSeconds: number;
}

export interface DashboardStats {
  coursesInProgress: number;
  coursesCompleted: number;
  totalCourses: number;
  totalWatchedSeconds: number;
  overallCompletionPercent: number;
  streakDays: number;
}

export interface DashboardOverview {
  user: UserProfile;
  drive: DriveConnectionStatus;
  stats: DashboardStats;
  continueWatching: ContinueWatchingItem | null;
  courses: CourseSummary[];
}

export interface ImportDriveFolderResult {
  courseId: string;
  title: string;
  modulesCount: number;
  lessonsCount: number;
  documentsCount: number;
  warning?: string;
}

export interface AuthConfigStatus {
  googleConfigured: boolean;
  pickerConfigured: boolean;
  driveScope: string;
}

export interface DriveFolderEntry {
  id: string;
  name: string;
  modifiedTime?: string | null;
}

export interface DriveFileEntry {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  durationSeconds: number;
  modifiedTime?: string | null;
}

export interface DriveFolderListResponse {
  parentId: string;
  parentName: string;
  folders: DriveFolderEntry[];
}

export interface DriveItemsListResponse {
  parentId: string;
  parentName: string;
  folders: DriveFolderEntry[];
  files: DriveFileEntry[];
}

export interface ImportRootFolderResult {
  rootFolderName: string;
  coursesImported: number;
  totalModules: number;
  totalLessons: number;
  courses: ImportDriveFolderResult[];
}

export interface LessonNote {
  id: string;
  userId: string;
  lessonId?: string | null;
  timeSeconds?: number | null;
  content: string;
  lessonTitleSnapshot?: string | null;
  courseTitleSnapshot?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LessonCodeAnchor {
  id: string;
  userId: string;
  lessonId: string;
  timeSeconds: number;
  title: string;
  codeContent: string;
  language: string;
  filePath?: string | null;
  createdAt: string;
}

export interface RetrievalChunkResult {
  id: string;
  documentId: string;
  content: string;
  locator: DocumentLocator;
  rrfScore: number;
  cosineSimilarity: number;
}

export interface CopilotMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  citations?: Array<{
    chunkId: string;
    locator: DocumentLocator;
    documentTitle?: string;
  }>;
}

