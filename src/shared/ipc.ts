// Canonical IPC contract between preload (CalcoAPI) and main process handlers.
// file.open/save/saveAs/import/export all carry raw bytes -- main never
// parses any file format, it only does dialogs + fs I/O (see
// renderer/formats/ for the pack/unpack + xlsx/csv conversion logic, which
// lives in the sandboxed renderer).

export interface OpenResult {
  path: string
  bytes: Uint8Array
}

export type ImportFormat = 'xlsx' | 'csv'
export type ExportFormat = 'xlsx' | 'csv'

export interface SaveResult {
  ok: boolean
  path?: string
  message?: string
}

export interface RecentFile {
  path: string
  name: string
}

export type MenuAction =
  | { type: 'about' }
  | { type: 'new' }
  | { type: 'open' }
  | { type: 'save' }
  | { type: 'saveAs' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'import'; format: ImportFormat }
  | { type: 'export'; format: ExportFormat }

export interface CalcoAPI {
  file: {
    open(): Promise<OpenResult | null>
    save(bytes: Uint8Array, path: string): Promise<SaveResult>
    saveAs(bytes: Uint8Array): Promise<SaveResult>
    // Renderer-parsed, same as open/save -- main only shows the dialog and
    // reads/writes the raw bytes it gets back.
    import(format: ImportFormat): Promise<OpenResult | null>
    export(bytes: Uint8Array, format: ExportFormat): Promise<SaveResult>
    getRecent(): Promise<RecentFile[]>
  }
  app: {
    getVersion(): Promise<string>
    onMenuAction(cb: (action: MenuAction) => void): void
  }
  clipboard: {
    // Writes both formats in one shot, matching Excel/Sheets' own dual-format
    // clipboard convention (text/html for rich targets, text/plain fallback).
    writeHtml(html: string, text: string): Promise<void>
    readText(): Promise<string>
  }
}

export const IPC_CHANNELS = {
  fileOpen: 'file:open',
  fileSave: 'file:save',
  fileSaveAs: 'file:save-as',
  fileImport: 'file:import',
  fileExport: 'file:export',
  fileGetRecent: 'file:get-recent',
  appGetVersion: 'app:get-version',
  menuAction: 'menu:action',
  clipboardWriteHtml: 'clipboard:write-html',
  clipboardReadText: 'clipboard:read-text'
} as const
