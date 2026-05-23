/**
 * JWT / base64url 工具
 *
 * 从 abc.txt(@P0me1oo 的油猴脚本)移植,纯前端实现,不依赖 Node Buffer。
 * ChatGPT Web session 通常没有真实 id_token,需要根据 access_token payload
 * 合成一个 Codex 可识别的占位 JWT,所以除了 decode 还需要 encode。
 */

/** 把 base64url 字符串解码成 UTF-8 文本 */
export function decodeBase64Url(value: string): string {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** 把字节数组编码成 base64url(去掉末尾 = 号) */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + 0x8000)),
    )
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

/** 把任意可 JSON 序列化的值编码成 base64url JSON 字符串 */
export function encodeBase64UrlJson(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)))
}

/** 解析 JWT 的 payload 段;失败返回 undefined */
export function parseJwtPayload(token: unknown): Record<string, unknown> | undefined {
  if (typeof token !== 'string' || token.trim() === '') return undefined
  const segments = token.split('.')
  if (segments.length < 2) return undefined
  try {
    const decoded = JSON.parse(decodeBase64Url(segments[1]))
    return decoded && typeof decoded === 'object' ? (decoded as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}
