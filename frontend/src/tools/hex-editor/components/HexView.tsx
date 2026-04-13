import { useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'
import { decodeRow, type EncodingId } from '../logic/encodings'
import {
  formatByte,
  formatOffset,
  radixCellWidth,
  type Radix,
} from '../logic/format'

const BYTES_PER_ROW = 16
const ROW_HEIGHT = 22

interface HexViewProps {
  bytes: Uint8Array
  cursor: number
  onCursorChange: (off: number) => void
  radix: Radix
  encoding: EncodingId
  onScrollToOffset?: (fn: (off: number) => void) => void
}

export function HexView({
  bytes,
  cursor,
  onCursorChange,
  radix,
  encoding,
  onScrollToOffset,
}: HexViewProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const numRows = Math.ceil(bytes.length / BYTES_PER_ROW) || 1

  const virtualizer = useVirtualizer({
    count: numRows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  // 暴露跳转能力给外部（如 toolbar 跳转输入框）
  useEffect(() => {
    if (!onScrollToOffset) return
    onScrollToOffset((off: number) => {
      const row = Math.floor(off / BYTES_PER_ROW)
      virtualizer.scrollToIndex(row, { align: 'center' })
    })
  }, [onScrollToOffset, virtualizer])

  // 光标改变时滚到可见区
  useEffect(() => {
    const row = Math.floor(cursor / BYTES_PER_ROW)
    const visible = virtualizer.getVirtualItems()
    if (visible.length === 0) return
    const first = visible[0].index
    const last = visible[visible.length - 1].index
    if (row < first || row > last) {
      virtualizer.scrollToIndex(row, { align: 'center' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor])

  const cellWidth = radixCellWidth(radix)
  // ch 单位下的列宽：每字节 cellWidth + 1 空格，第 8 字节后多一空格
  const hexAreaCh = BYTES_PER_ROW * (cellWidth + 1) + 1

  return (
    <div
      ref={parentRef}
      className="relative h-full overflow-auto bg-card font-mono text-[12px] leading-[22px]"
      tabIndex={0}
      onKeyDown={(e) => handleKey(e, cursor, bytes.length, onCursorChange)}
    >
      {/* 顶部对齐用的占位 */}
      <div
        style={{ height: virtualizer.getTotalSize() }}
        className="relative w-full"
      >
        {virtualizer.getVirtualItems().map((vr) => {
          const rowStart = vr.index * BYTES_PER_ROW
          const rowBytes = bytes.subarray(rowStart, rowStart + BYTES_PER_ROW)
          return (
            <div
              key={vr.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: ROW_HEIGHT,
                transform: `translateY(${vr.start}px)`,
              }}
              className="flex items-center whitespace-pre"
            >
              {/* 偏移列 */}
              <span className="shrink-0 select-none px-3 text-muted-foreground">
                {formatOffset(rowStart, bytes.length)}
              </span>
              {/* hex 列 */}
              <span
                className="shrink-0"
                style={{ width: `${hexAreaCh}ch` }}
              >
                {Array.from(rowBytes).map((b, i) => {
                  const off = rowStart + i
                  const isCursor = off === cursor
                  return (
                    <span key={i}>
                      <span
                        onMouseDown={() => onCursorChange(off)}
                        className={cn(
                          'cursor-pointer transition-colors',
                          isCursor
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-accent'
                        )}
                      >
                        {formatByte(b, radix)}
                      </span>
                      {i === 7 ? '  ' : ' '}
                    </span>
                  )
                })}
              </span>
              {/* text 列 */}
              <span className="ml-2 shrink-0 border-l border-border pl-3 text-foreground/90">
                <TextRow
                  rowStart={rowStart}
                  rowBytes={rowBytes}
                  cursor={cursor}
                  encoding={encoding}
                  onCursorChange={onCursorChange}
                />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TextRow({
  rowStart,
  rowBytes,
  cursor,
  encoding,
  onCursorChange,
}: {
  rowStart: number
  rowBytes: Uint8Array
  cursor: number
  encoding: EncodingId
  onCursorChange: (off: number) => void
}) {
  const decoded = useMemo(() => decodeRow(rowBytes, encoding), [rowBytes, encoding])
  // 单字节编码（ASCII / Latin-1）保证 1 byte = 1 char，可逐字节高亮
  const oneToOne = encoding === 'ascii' || encoding === 'latin1'
  if (oneToOne) {
    return (
      <>
        {Array.from(decoded).map((ch, i) => {
          const off = rowStart + i
          const isCursor = off === cursor
          if (i >= rowBytes.length) return null
          return (
            <span
              key={i}
              onMouseDown={() => onCursorChange(off)}
              className={cn(
                'cursor-pointer',
                isCursor ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
              )}
            >
              {ch}
            </span>
          )
        })}
      </>
    )
  }
  // 多字节编码：char 数和 byte 数不对应，整段显示，无逐字节高亮
  return <span>{decoded}</span>
}

function handleKey(
  e: React.KeyboardEvent,
  cursor: number,
  total: number,
  set: (off: number) => void
) {
  let next = cursor
  if (e.key === 'ArrowLeft') next = cursor - 1
  else if (e.key === 'ArrowRight') next = cursor + 1
  else if (e.key === 'ArrowUp') next = cursor - BYTES_PER_ROW
  else if (e.key === 'ArrowDown') next = cursor + BYTES_PER_ROW
  else if (e.key === 'PageUp') next = cursor - BYTES_PER_ROW * 16
  else if (e.key === 'PageDown') next = cursor + BYTES_PER_ROW * 16
  else if (e.key === 'Home')
    next = e.ctrlKey ? 0 : Math.floor(cursor / BYTES_PER_ROW) * BYTES_PER_ROW
  else if (e.key === 'End')
    next = e.ctrlKey
      ? total - 1
      : Math.floor(cursor / BYTES_PER_ROW) * BYTES_PER_ROW + BYTES_PER_ROW - 1
  else return
  e.preventDefault()
  set(Math.max(0, Math.min(total - 1, next)))
}
