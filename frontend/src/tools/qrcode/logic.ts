import QRCode from 'qrcode'

export type ErrorLevel = 'L' | 'M' | 'Q' | 'H'

export const ERROR_LEVELS: { value: ErrorLevel; label: string }[] = [
  { value: 'L', label: '低 (~7%)' },
  { value: 'M', label: '中 (~15%)' },
  { value: 'Q', label: '较高 (~25%)' },
  { value: 'H', label: '高 (~30%)' },
]

export async function renderToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  level: ErrorLevel,
  size: number
): Promise<void> {
  await QRCode.toCanvas(canvas, text, {
    errorCorrectionLevel: level,
    width: size,
    margin: 2,
    color: { dark: '#000000ff', light: '#ffffffff' },
  })
}

export async function renderToDataUrl(
  text: string,
  level: ErrorLevel,
  size: number
): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: level,
    width: size,
    margin: 2,
  })
}
