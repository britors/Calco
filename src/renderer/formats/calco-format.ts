import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { SerializedWorkbook } from '@shared/model'

const KNOWN_FORMAT_VERSIONS = new Set([1])

interface Manifest {
  formatVersion: number
  generatedBy: string
}

/** Pure, sync .calco encoder -- no Electron/IPC dependency, easy to unit test. */
export function packCalcoFile(doc: SerializedWorkbook, appVersion: string): Uint8Array {
  const manifest: Manifest = {
    formatVersion: doc.formatVersion,
    generatedBy: `Calco ${appVersion}`
  }
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'workbook.json': strToU8(JSON.stringify(doc))
  })
}

export function unpackCalcoFile(bytes: Uint8Array): SerializedWorkbook {
  const entries = unzipSync(bytes)
  const manifestEntry = entries['manifest.json']
  const workbookEntry = entries['workbook.json']
  if (!manifestEntry || !workbookEntry) {
    throw new Error('Arquivo .calco inválido: manifest.json ou workbook.json ausente.')
  }

  const manifest = JSON.parse(strFromU8(manifestEntry)) as Manifest
  if (!KNOWN_FORMAT_VERSIONS.has(manifest.formatVersion)) {
    throw new Error(`Versão de formato .calco não suportada: ${manifest.formatVersion}`)
  }

  return JSON.parse(strFromU8(workbookEntry)) as SerializedWorkbook
}
