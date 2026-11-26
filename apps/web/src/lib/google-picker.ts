import type { PickerTokenResponse } from '@devcore/shared';

export interface PickedDriveItem {
  id: string;
  name: string;
  mimeType: string;
}

interface GooglePickerDocument {
  id: string;
  name: string;
  mimeType: string;
}

interface GooglePickerResponse {
  action: string;
  docs?: GooglePickerDocument[];
}

interface GooglePickerApi {
  Action: { PICKED: string; CANCEL: string };
  ViewId: { FOLDERS: string; DOCS: string };
  DocsViewMode: { LIST: string; GRID: string };
  Feature: { MULTISELECT_ENABLED: string; SUPPORT_DRIVES: string };
  DocsView: new (viewId?: string) => {
    setIncludeFolders(val: boolean): unknown;
    setSelectFolderEnabled(val: boolean): unknown;
    setMimeTypes(mimeTypes: string): unknown;
    setParent(parentId: string): unknown;
    setMode(mode: unknown): unknown;
  };
  PickerBuilder: new () => {
    setOAuthToken(token: string): GooglePickerBuilder;
    setDeveloperKey(key: string): GooglePickerBuilder;
    setAppId(appId: string): GooglePickerBuilder;
    setOrigin(origin: string): GooglePickerBuilder;
    setTitle(title: string): GooglePickerBuilder;
    setLocale(locale: string): GooglePickerBuilder;
    enableFeature(feature: string): GooglePickerBuilder;
    addView(view: unknown): GooglePickerBuilder;
    setCallback(cb: (data: GooglePickerResponse) => void): GooglePickerBuilder;
    build(): { setVisible(visible: boolean): void };
  };
}

type GooglePickerBuilder = InstanceType<GooglePickerApi['PickerBuilder']>;

declare global {
  interface Window {
    gapi?: {
      load: (api: string, opts: { callback: () => void; onerror?: () => void }) => void;
    };
    google?: {
      picker?: GooglePickerApi;
    };
  }
}

let pickerLoaderPromise: Promise<GooglePickerApi> | null = null;

function loadGooglePickerApi(): Promise<GooglePickerApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Picker só pode ser aberto no navegador.'));
  }

  if (window.google?.picker) {
    return Promise.resolve(window.google.picker);
  }

  if (pickerLoaderPromise) {
    return pickerLoaderPromise;
  }

  pickerLoaderPromise = new Promise<GooglePickerApi>((resolve, reject) => {
    const loadPickerModule = () => {
      if (!window.gapi) {
        reject(new Error('Script gapi do Google não foi carregado.'));
        return;
      }
      window.gapi.load('picker', {
        callback: () => {
          if (window.google?.picker) {
            resolve(window.google.picker);
          } else {
            reject(new Error('Google Picker API indisponível após carregamento.'));
          }
        },
        onerror: () => reject(new Error('Erro ao carregar o módulo Google Picker.')),
      });
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://apis.google.com/js/api.js"]',
    );

    if (existingScript) {
      if (window.gapi) {
        loadPickerModule();
      } else {
        existingScript.addEventListener('load', loadPickerModule, { once: true });
        existingScript.addEventListener(
          'error',
          () => reject(new Error('Falha ao baixar apis.google.com/js/api.js.')),
          { once: true },
        );
      }
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    script.onload = loadPickerModule;
    script.onerror = () => {
      pickerLoaderPromise = null;
      reject(new Error('Não foi possível carregar o Google Picker. Verifique sua conexão.'));
    };
    document.body.appendChild(script);
  });

  return pickerLoaderPromise;
}

/**
 * Abre o Google Picker configurado para selecionar uma PASTA DE CURSO no Google Drive.
 */
export async function openDriveFolderPicker(
  tokenInfo: PickerTokenResponse,
): Promise<PickedDriveItem | null> {
  const pickerApi = await loadGooglePickerApi();

  return new Promise<PickedDriveItem | null>((resolve) => {
    const folderView = new pickerApi.DocsView(pickerApi.ViewId.FOLDERS);
    folderView.setIncludeFolders(true);
    folderView.setSelectFolderEnabled(true);
    folderView.setParent('root');
    if (pickerApi.DocsViewMode?.LIST) {
      folderView.setMode(pickerApi.DocsViewMode.LIST);
    }
    folderView.setMimeTypes('application/vnd.google-apps.folder');

    const builder = new pickerApi.PickerBuilder()
      .setOAuthToken(tokenInfo.accessToken)
      .setDeveloperKey(tokenInfo.apiKey)
      .setOrigin(`${window.location.protocol}//${window.location.host}`)
      .setLocale('pt-BR')
      .setTitle('Selecione a pasta do curso no Google Drive')
      .enableFeature(pickerApi.Feature.SUPPORT_DRIVES)
      .addView(folderView)
      .setCallback((data: GooglePickerResponse) => {
        const doc = data.docs?.[0];
        if (data.action === pickerApi.Action.PICKED && doc) {
          resolve({
            id: doc.id,
            name: doc.name,
            mimeType: doc.mimeType,
          });
        } else if (data.action === pickerApi.Action.CANCEL) {
          resolve(null);
        }
      });

    if (tokenInfo.appId) {
      builder.setAppId(tokenInfo.appId);
    }

    builder.build().setVisible(true);
  });
}

/**
 * Abre o Google Picker em modo multi-seleção para escolher vídeos, PDFs e materiais de aula.
 */
export async function openDriveFilesPicker(
  tokenInfo: PickerTokenResponse,
  parentId = 'root',
  title = 'Selecione os vídeos e materiais das aulas',
): Promise<PickedDriveItem[]> {
  const pickerApi = await loadGooglePickerApi();

  return new Promise<PickedDriveItem[]>((resolve) => {
    const docsView = new pickerApi.DocsView(pickerApi.ViewId.DOCS);
    docsView.setIncludeFolders(true);
    docsView.setSelectFolderEnabled(false);
    docsView.setParent(parentId || 'root');
    if (pickerApi.DocsViewMode?.LIST) {
      docsView.setMode(pickerApi.DocsViewMode.LIST);
    }

    const builder = new pickerApi.PickerBuilder()
      .setOAuthToken(tokenInfo.accessToken)
      .setDeveloperKey(tokenInfo.apiKey)
      .setOrigin(`${window.location.protocol}//${window.location.host}`)
      .setLocale('pt-BR')
      .setTitle(title)
      .enableFeature(pickerApi.Feature.MULTISELECT_ENABLED)
      .enableFeature(pickerApi.Feature.SUPPORT_DRIVES)
      .addView(docsView)
      .setCallback((data: GooglePickerResponse) => {
        if (data.action === pickerApi.Action.PICKED && data.docs) {
          resolve(
            data.docs.map((doc) => ({
              id: doc.id,
              name: doc.name,
              mimeType: doc.mimeType,
            })),
          );
        } else if (data.action === pickerApi.Action.CANCEL) {
          resolve([]);
        }
      });

    if (tokenInfo.appId) {
      builder.setAppId(tokenInfo.appId);
    }

    builder.build().setVisible(true);
  });
}
