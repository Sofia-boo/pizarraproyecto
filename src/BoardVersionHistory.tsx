import { useEffect, useState } from 'react'
import {
  listBoardHistory, createBoardHistory, inspectBoardHistory,
  restoreBoardHistory, deleteBoardHistoryVersion, clearBoardHistory,
  getActiveBoardVersion,
} from './biblioteca'
import type { BoardHistoryVersion, BoardHistoryList } from './biblioteca'
import './version_history.css'

type HistoryPreview = {
  version: BoardHistoryVersion
  counts: { label: string; count: number }[]
  textSamples: string[]
}

type Props = {
  boardId: string
  boardName: string
  isActive: boolean
  beforeCurrentOperation: () => Promise<void>
  onClose: () => void
  onRestored: () => void
}

function dateLabel(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })
}
function kindLabel(kind: BoardHistoryVersion['kind']) {
  return kind === 'manual' ? 'Guardada manualmente' : kind === 'safety' ? 'Copia de seguridad' : 'Automática'
}
function readableBytes(bytes: number) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export default function BoardVersionHistory({ boardId, boardName, isActive, beforeCurrentOperation, onClose, onRestored }: Props) {
  const [data, setData] = useState<BoardHistoryList | null>(null)
  const [preview, setPreview] = useState<HistoryPreview | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  async function refresh() {
    setData(await listBoardHistory(boardId))
  }

  useEffect(() => {
    let alive = true
    async function initialLoad() {
      setLoading(true)
      try {
        // No listar una versión desactualizada si la pizarra actual aún se guarda.
        if (isActive) await beforeCurrentOperation()
        const result = await listBoardHistory(boardId)
        if (alive) setData(result)
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (alive) setLoading(false)
      }
    }
    void initialLoad()
    return () => { alive = false }
  }, [boardId, isActive])

  async function execute(action: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  async function prepare(): Promise<number | undefined> {
    if (!isActive) return undefined
    await beforeCurrentOperation()
    return getActiveBoardVersion()
  }

  async function saveManual() {
    await execute(async () => {
      const expected = await prepare()
      await createBoardHistory(boardId, title.trim(), expected)
      setTitle('')
      await refresh()
      setNotice('Versión guardada. Podés restaurarla cuando quieras.')
    })
  }

  async function showPreview(version: BoardHistoryVersion) {
    await execute(async () => {
      const full = await inspectBoardHistory(boardId, version.id)
      const content = full.content
      const named = [
        ['Trazos', content.strokes], ['Textos', content.texts],
        ['Imágenes y PDF', content.media], ['Figuras', content.shapes],
        ['Tablas', content.tables], ['Gráficos', content.graphs],
      ] as const
      const counts = named.map(([label, values]) => ({label, count: Array.isArray(values) ? values.length : 0}))
      const textSamples = (Array.isArray(content.texts) ? content.texts : [])
        .slice(0, 5).map(t => String(t?.text ?? '').slice(0, 140)).filter(Boolean)
      setPreview({version, counts, textSamples})
    })
  }

  async function restore(version: BoardHistoryVersion) {
    if (!window.confirm(`¿Restaurar la versión del ${dateLabel(version.created_at)}?\n\nEl estado actual se conservará como una copia de seguridad antes de restaurar.`)) return
    await execute(async () => {
      const expected = await prepare()
      await restoreBoardHistory(boardId, version.id, expected)
      onRestored()
    })
  }

  async function remove(version: BoardHistoryVersion) {
    if (!window.confirm(`¿Eliminar permanentemente la versión del ${dateLabel(version.created_at)}?\n\nLa pizarra actual no se modificará.`)) return
    await execute(async () => {
      await deleteBoardHistoryVersion(boardId, version.id)
      setPreview(p => p?.version.id === version.id ? null : p)
      await refresh()
      setNotice('Versión eliminada.')
    })
  }

  async function removeAll() {
    if (!data?.history.length || busy) return
    await execute(async () => {
      await clearBoardHistory(boardId)
      setConfirmClear(false)
      setPreview(null)
      await refresh()
      setNotice('Se borró el historial guardado de esta pizarra.')
    })
  }

  return <div className="version-history-backdrop" onPointerDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="version-history-dialog" role="dialog" aria-modal={!confirmClear} aria-label={`Historial de versiones de ${boardName}`} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); if (confirmClear) setConfirmClear(false); else onClose() } }}>
      <header className="version-history-heading">
        <div><h2>Historial de versiones</h2><p>{boardName}</p></div>
        <button type="button" aria-label="Cerrar historial" title="Cerrar" disabled={busy} onClick={onClose}>×</button>
      </header>
      <div className="version-history-main">
        <div className="version-history-save">
          <label htmlFor="version-history-title">Nombre de la versión (opcional)</label>
          <div>
            <input id="version-history-title" maxLength={120} placeholder="Ej.: Antes del parcial" value={title} onChange={event => setTitle(event.target.value)} />
            <button className="history-primary" type="button" disabled={busy || loading} onClick={() => void saveManual()}>Guardar versión actual</button>
          </div>
        </div>
        <p className="version-history-help">Se guarda una versión automática aproximadamente cada 5 horas si hubo cambios. También podés guardar versiones manuales en cualquier momento.</p>
        {error && <p role="alert" className="version-history-error">{error}</p>}
        {notice && <p role="status" className="version-history-notice">{notice}</p>}
        <div className="version-history-section-heading">
          <strong>Versiones guardadas {data ? `(${data.history.length})` : ''}</strong>
          <button className="history-danger-outline" type="button" disabled={busy || !data?.history.length} onClick={() => setConfirmClear(true)}>Borrar historial</button>
        </div>
        {loading ? <p className="version-history-empty">Cargando versiones…</p>
          : !data?.history.length ? <p className="version-history-empty">Esta pizarra todavía no tiene versiones guardadas. Podés crear la primera con el botón de arriba.</p>
          : <div className="version-history-list">
              {data.history.map(version => <div className="version-history-item" key={version.id}>
                <div className="version-history-item-info">
                  <strong>{version.title || kindLabel(version.kind)}</strong>
                  <span>{dateLabel(version.created_at)} · {kindLabel(version.kind)}</span>
                  <small>Versión {version.board_version} · {readableBytes(version.size_bytes)}</small>
                </div>
                <div className="version-history-item-actions">
                  <button type="button" disabled={busy} onClick={() => void showPreview(version)}>Detalles</button>
                  <button type="button" className="history-restore" disabled={busy} onClick={() => void restore(version)}>Restaurar</button>
                  <button type="button" className="history-delete" aria-label="Eliminar versión" title="Eliminar esta versión" disabled={busy} onClick={() => void remove(version)}>×</button>
                </div>
              </div>)}
            </div>}
        {preview && <aside className="version-history-preview">
          <div><strong>Contenido de esta versión</strong><button type="button" onClick={() => setPreview(null)}>Cerrar detalles</button></div>
          <p>{dateLabel(preview.version.created_at)}</p>
          <div className="version-history-stats">
            {preview.counts.map(item => <span key={item.label}>{item.label}: <b>{item.count}</b></span>)}
          </div>
          {preview.textSamples.length > 0 && <div className="version-history-texts"><strong>Fragmentos de texto</strong>{preview.textSamples.map((text, i) => <p key={i}>{text}</p>)}</div>}
        </aside>}
        <p className="version-history-footer">Borrar versiones no borra tu pizarra actual. Restaurar crea una copia de seguridad del estado anterior. Las versiones son locales y se almacenan en la base de datos de tu proyecto.</p>
      </div>
    </section>
    {confirmClear && <div className="history-clear-overlay" onPointerDown={event => {
      event.stopPropagation()
      if (event.target === event.currentTarget && !busy) setConfirmClear(false)
    }}>
      <section className="history-clear-dialog" role="alertdialog" aria-modal="true" aria-labelledby="history-clear-title" aria-describedby="history-clear-description" onKeyDown={event => {
        if (event.key === 'Escape' && !busy) { event.stopPropagation(); setConfirmClear(false) }
      }}>
        <h3 id="history-clear-title">¿Querés borrar todo el historial?</h3>
        <p id="history-clear-description">Se eliminarán las {data?.history.length ?? 0} versiones guardadas de «{boardName}».
          La pizarra actual no se borrará, pero no podrás recuperar las versiones eliminadas.</p>
        <div className="history-clear-actions">
          <button type="button" autoFocus disabled={busy} onClick={() => setConfirmClear(false)}>Cancelar</button>
          <button type="button" className="history-clear-confirm" disabled={busy} onClick={() => void removeAll()}>{busy ? 'Eliminando…' : 'Eliminar historial'}</button>
        </div>
      </section>
    </div>}
  </div>
}
