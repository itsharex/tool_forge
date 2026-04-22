import { useState } from 'react'
import { BytesField, DataField, ErrorBanner, OpRow } from '../ui'
import { fromBytes, toBytes, type DataEncoding } from '../lib/encoding'
import { aesDecrypt, aesEncrypt, chachaDecrypt, chachaEncrypt } from '../lib/aes'

type Algo = 'AES-GCM' | 'AES-CBC' | 'ChaCha20-Poly1305'

export function AesTab() {
  const [algo, setAlgo] = useState<Algo>('AES-GCM')
  const [direction, setDir] = useState<'enc' | 'dec'>('enc')
  const [key, setKey] = useState('00112233445566778899aabbccddeeff')
  const [keyEnc, setKeyEnc] = useState<DataEncoding>('hex')
  const [iv, setIv] = useState('')
  const [ivEnc, setIvEnc] = useState<DataEncoding>('hex')
  const [useCustomIv, setUseCustomIv] = useState(false)

  const [input, setInput] = useState('hello crypto lab')
  const [inputEnc, setInputEnc] = useState<DataEncoding>('utf8')
  const [output, setOutput] = useState('')
  const [outputEnc, setOutputEnc] = useState<DataEncoding>('base64')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const ivSize = algo === 'AES-GCM' ? 12 : algo === 'AES-CBC' ? 16 : 12

  const execute = async () => {
    setError('')
    setBusy(true)
    try {
      const keyBytes = toBytes(key, keyEnc)
      const ivBytes = useCustomIv && iv ? toBytes(iv, ivEnc) : undefined
      if (direction === 'enc') {
        const plainBytes = toBytes(input, inputEnc)
        let ct: Uint8Array
        if (algo === 'ChaCha20-Poly1305') {
          ct = await chachaEncrypt(keyBytes, plainBytes, ivBytes)
        } else {
          ct = await aesEncrypt(algo === 'AES-GCM' ? 'GCM' : 'CBC', keyBytes, plainBytes, ivBytes)
        }
        setOutput(fromBytes(ct, outputEnc))
      } else {
        const ctBytes = toBytes(input, inputEnc)
        let pt: Uint8Array
        if (algo === 'ChaCha20-Poly1305') {
          pt = await chachaDecrypt(keyBytes, ctBytes, ivBytes)
        } else {
          pt = await aesDecrypt(algo === 'AES-GCM' ? 'GCM' : 'CBC', keyBytes, ctBytes, ivBytes)
        }
        setOutput(fromBytes(pt, outputEnc))
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">算法</span>
        <select
          value={algo}
          onChange={(e) => setAlgo(e.target.value as Algo)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none"
        >
          <option value="AES-GCM">AES-GCM</option>
          <option value="AES-CBC">AES-CBC</option>
          <option value="ChaCha20-Poly1305">ChaCha20-Poly1305</option>
        </select>
        <span className="text-[10px] text-muted-foreground">
          {algo === 'AES-GCM' && '认证加密 · 推荐'}
          {algo === 'AES-CBC' && '经典兼容 · 不含认证'}
          {algo === 'ChaCha20-Poly1305' && '认证加密 · 移动/嵌入式友好'}
        </span>
      </div>

      <BytesField
        label={
          algo === 'ChaCha20-Poly1305'
            ? '密钥（必须 32 字节）'
            : '密钥（16/24/32 字节）'
        }
        value={key}
        onChange={setKey}
        enc={keyEnc}
        onEnc={setKeyEnc}
        randomSize={algo === 'ChaCha20-Poly1305' ? 32 : 32}
        placeholder="输入密钥"
      />

      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={useCustomIv}
            onChange={(e) => setUseCustomIv(e.target.checked)}
          />
          自定义 {algo === 'ChaCha20-Poly1305' ? 'nonce' : 'IV'}
        </label>
        <span className="text-[10px] text-muted-foreground">
          {direction === 'enc'
            ? `未指定则随机生成，加密结果前 ${ivSize} 字节即为 IV`
            : `未指定则从密文前 ${ivSize} 字节解析`}
        </span>
      </div>
      {useCustomIv && (
        <BytesField
          label={`${algo === 'ChaCha20-Poly1305' ? 'nonce' : 'IV'}（${ivSize} 字节）`}
          value={iv}
          onChange={setIv}
          enc={ivEnc}
          onEnc={setIvEnc}
          randomSize={ivSize}
          requiredSize={ivSize}
        />
      )}

      <DataField
        label={direction === 'enc' ? '明文输入' : '密文输入'}
        value={input}
        onChange={setInput}
        enc={inputEnc}
        onEnc={setInputEnc}
        rows={5}
      />

      <OpRow direction={direction} onChangeDirection={setDir} onExecute={execute} busy={busy} />

      <ErrorBanner error={error} />

      <DataField
        label="输出"
        value={output}
        onChange={() => {}}
        readOnly
        enc={outputEnc}
        onEnc={setOutputEnc}
        rows={5}
      />
    </div>
  )
}
