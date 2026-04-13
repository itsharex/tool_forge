export interface InspectorValues {
  int8: number | null
  uint8: number | null
  int16le: number | null
  int16be: number | null
  uint16le: number | null
  uint16be: number | null
  int32le: number | null
  int32be: number | null
  uint32le: number | null
  uint32be: number | null
  int64le: bigint | null
  int64be: bigint | null
  uint64le: bigint | null
  uint64be: bigint | null
  float32le: number | null
  float32be: number | null
  float64le: number | null
  float64be: number | null
  asciiChar: string | null
}

export function computeInspector(
  bytes: Uint8Array,
  offset: number
): InspectorValues {
  const avail = bytes.length - offset
  const need = Math.min(8, Math.max(0, avail))
  const dv =
    need > 0
      ? new DataView(bytes.buffer, bytes.byteOffset + offset, need)
      : null

  const ascii = bytes[offset]
  const isPrintable = ascii !== undefined && ascii >= 0x20 && ascii <= 0x7e

  return {
    int8: avail >= 1 && dv ? dv.getInt8(0) : null,
    uint8: avail >= 1 && dv ? dv.getUint8(0) : null,
    int16le: avail >= 2 && dv ? dv.getInt16(0, true) : null,
    int16be: avail >= 2 && dv ? dv.getInt16(0, false) : null,
    uint16le: avail >= 2 && dv ? dv.getUint16(0, true) : null,
    uint16be: avail >= 2 && dv ? dv.getUint16(0, false) : null,
    int32le: avail >= 4 && dv ? dv.getInt32(0, true) : null,
    int32be: avail >= 4 && dv ? dv.getInt32(0, false) : null,
    uint32le: avail >= 4 && dv ? dv.getUint32(0, true) : null,
    uint32be: avail >= 4 && dv ? dv.getUint32(0, false) : null,
    int64le: avail >= 8 && dv ? dv.getBigInt64(0, true) : null,
    int64be: avail >= 8 && dv ? dv.getBigInt64(0, false) : null,
    uint64le: avail >= 8 && dv ? dv.getBigUint64(0, true) : null,
    uint64be: avail >= 8 && dv ? dv.getBigUint64(0, false) : null,
    float32le: avail >= 4 && dv ? dv.getFloat32(0, true) : null,
    float32be: avail >= 4 && dv ? dv.getFloat32(0, false) : null,
    float64le: avail >= 8 && dv ? dv.getFloat64(0, true) : null,
    float64be: avail >= 8 && dv ? dv.getFloat64(0, false) : null,
    asciiChar: isPrintable ? String.fromCharCode(ascii) : null,
  }
}
