import { base64ToBytes, bytesToBase64 } from './encoding'

export type RsaHash = 'SHA-256' | 'SHA-384' | 'SHA-512'

export async function rsaGenerateKeyPair(
  bits: 2048 | 3072 | 4096,
): Promise<{ publicKeyPem: string; privateKeyPem: string }> {
  // 生成 OAEP 用的 key；同一把 key 也可以用于 PSS（只是 usage 需 sign/verify）。
  // 为了兼容，我们同时导出 PKCS#8 私钥 + SPKI 公钥，支持 OAEP 与 PSS。
  const kp = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: bits,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  )
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey))
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey('pkcs8', kp.privateKey),
  )
  return {
    publicKeyPem: toPem(spki, 'PUBLIC KEY'),
    privateKeyPem: toPem(pkcs8, 'PRIVATE KEY'),
  }
}

export async function rsaOaepEncrypt(
  publicPem: string,
  hash: RsaHash,
  plain: Uint8Array,
): Promise<Uint8Array> {
  const key = await importSpkiPublicKey(publicPem, { name: 'RSA-OAEP', hash })
  return new Uint8Array(
    await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, plain as any),
  )
}

export async function rsaOaepDecrypt(
  privatePem: string,
  hash: RsaHash,
  cipher: Uint8Array,
): Promise<Uint8Array> {
  const key = await importPkcs8PrivateKey(privatePem, { name: 'RSA-OAEP', hash }, [
    'decrypt',
  ])
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, cipher as any),
  )
}

export async function rsaPssSign(
  privatePem: string,
  hash: RsaHash,
  data: Uint8Array,
  saltLength = 32,
): Promise<Uint8Array> {
  const key = await importPkcs8PrivateKey(privatePem, { name: 'RSA-PSS', hash }, [
    'sign',
  ])
  return new Uint8Array(
    await crypto.subtle.sign({ name: 'RSA-PSS', saltLength }, key, data as any),
  )
}

export async function rsaPssVerify(
  publicPem: string,
  hash: RsaHash,
  data: Uint8Array,
  signature: Uint8Array,
  saltLength = 32,
): Promise<boolean> {
  const key = await importSpkiPublicKey(publicPem, { name: 'RSA-PSS', hash }, [
    'verify',
  ])
  return await crypto.subtle.verify(
    { name: 'RSA-PSS', saltLength },
    key,
    signature as any,
    data as any,
  )
}

// ---- PEM 解析 ----
export function pemToBytes(pem: string): { label: string; bytes: Uint8Array } {
  const m = pem.match(/-----BEGIN ([^-]+)-----([\s\S]*?)-----END \1-----/)
  if (!m) throw new Error('不是合法 PEM 格式')
  const label = m[1].trim()
  const b64 = m[2].replace(/\s+/g, '')
  return { label, bytes: base64ToBytes(b64) }
}

function toPem(bytes: Uint8Array, label: string): string {
  const b64 = bytesToBase64(bytes)
  const lines = b64.match(/.{1,64}/g) || []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`
}

async function importSpkiPublicKey(
  pem: string,
  algo: any,
  usages: KeyUsage[] = ['encrypt'],
): Promise<CryptoKey> {
  const { bytes } = pemToBytes(pem)
  return crypto.subtle.importKey('spki', bytes as any, algo, true, usages)
}

async function importPkcs8PrivateKey(
  pem: string,
  algo: any,
  usages: KeyUsage[] = ['decrypt'],
): Promise<CryptoKey> {
  const { bytes } = pemToBytes(pem)
  return crypto.subtle.importKey('pkcs8', bytes as any, algo, true, usages)
}

// 简单 PEM 信息探测（不做完整 ASN.1 解析）
export function pemInfo(pem: string): {
  label: string
  sizeBytes: number
} {
  const { label, bytes } = pemToBytes(pem)
  return { label, sizeBytes: bytes.length }
}
