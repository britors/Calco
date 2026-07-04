// Canonical IPC contract between preload (CalcoAPI) and main process handlers.
// file.open/save/saveAs carry raw .calco bytes -- main never parses the
// format, it only does dialogs + fs I/O (see renderer/formats/calco-format.ts
// for the pack/unpack logic, which lives in the sandboxed renderer).

import type { SerializedWorkbook } from './model'

export interface OpenResult {
  path: string
  bytes: Uint8Array
}

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

export interface CalcoAPI {
  file: {
    open(): Promise<OpenResult | null>
    save(bytes: Uint8Array, path: string): Promise<SaveResult>
    saveAs(bytes: Uint8Array): Promise<SaveResult>
    // Still stubbed -- xlsx/csv/pdf export is a later milestone.
    export(doc: SerializedWorkbook, format: 'xlsx' | 'csv' | 'pdf'): Promise<SaveResult>
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
  fileExport: 'file:export',
  fileGetRecent: 'file:get-recent',
  appGetVersion: 'app:get-version',
  menuAction: 'menu:action',
  clipboardWriteHtml: 'clipboard:write-html',
  clipboardReadText: 'clipboard:read-text'
} as const
