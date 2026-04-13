import { useCallback, useEffect, useRef, useState } from 'react'

const MB = 1024 * 1024
export const FILE_DROP_SOFT_LIMIT = 5 * MB
export const FILE_DROP_HARD_LIMIT = 50 * MB

export interface FileDropTextResult {
  kind: 'text'
  text: string
  file: File
  oversized: boolean
}

export interface FileDropBinaryResult {
  kind: 'binary'
  buffer: ArrayBuffer
  file: File
  oversized: boolean
}

export type FileDropResult = FileDropTextResult | FileDropBinaryResult

export interface UseFileDropOptions {
  /** 允许的扩展名（小写，带点），用于在 drop 时过滤。为空则不过滤。 */
  accept?: string[]
  /** 返回二进制 ArrayBuffer 而不是文本（默认 false = 文本） */
  binary?: boolean
  onLoad: (result: FileDropResult) => void
  onError: (msg: string) => void
}

const hasFiles = (e: React.DragEvent) =>
  Array.from(e.dataTransfer?.types ?? []).includes('Files')

export function useFileDrop(opts: UseFileDropOptions) {
  const [dragOver, setDragOver] = useState(false)
  const counterRef = useRef(0)

  const reset = useCallback(() => {
    counterRef.current = 0
    setDragOver(false)
  }, [])

  useEffect(() => {
    const onWindowDragEnd = () => reset()
    const onDocMouseLeave = (e: MouseEvent) => {
      if (!e.relatedTarget && !(e as any).toElement) reset()
    }
    window.addEventListener('dragend', onWindowDragEnd)
    window.addEventListener('mouseup', onWindowDragEnd)
    document.addEventListener('mouseleave', onDocMouseLeave)
    return () => {
      window.removeEventListener('dragend', onWindowDragEnd)
      window.removeEventListener('mouseup', onWindowDragEnd)
      document.removeEventListener('mouseleave', onDocMouseLeave)
    }
  }, [reset])

  const matchesAccept = (file: File) => {
    if (!opts.accept || opts.accept.length === 0) return true
    const name = file.name.toLowerCase()
    return opts.accept.some((a) => name.endsWith(a))
  }

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    counterRef.current += 1
    setDragOver(true)
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return
    counterRef.current = Math.max(0, counterRef.current - 1)
    if (counterRef.current === 0) setDragOver(false)
  }, [])

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      reset()
      const file = e.dataTransfer.files?.[0]
      if (!file) return
      if (!matchesAccept(file)) {
        opts.onError(`不支持的文件类型：${file.name}`)
        return
      }
      if (file.size > FILE_DROP_HARD_LIMIT) {
        opts.onError(
          `文件过大（${(file.size / MB).toFixed(1)} MB），超过 ${FILE_DROP_HARD_LIMIT / MB} MB 上限`
        )
        return
      }
      try {
        const oversized = file.size > FILE_DROP_SOFT_LIMIT
        if (opts.binary) {
          const buffer = await file.arrayBuffer()
          opts.onLoad({ kind: 'binary', buffer, file, oversized })
        } else {
          const text = await file.text()
          opts.onLoad({ kind: 'text', text, file, oversized })
        }
      } catch (err) {
        opts.onError(err instanceof Error ? err.message : '读取文件失败')
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [opts, reset]
  )

  return {
    dragOver,
    dragHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
