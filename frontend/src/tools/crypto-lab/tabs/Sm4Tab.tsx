import { useState } from 'react'
import { BytesField, DataField, ErrorBanner, OpRow } from '../ui'
import { fromBytes, toBytes, type DataEncoding } from '../lib/encoding'
import { sm4Decrypt, sm4Encrypt, type Sm4Mode } from '../lib/sm'

export function Sm4Tab() {
  const [mode, setMode] = useState<Sm4Mode>('cbc')
  const [direction, setDir] = useState<'enc' | 'dec'>('enc')
  const [key, setKey] = useState('0123456789abcdeffedcba9876543210')
  const [keyEnc, setKeyEnc] = useState<DataEncoding>('hex')
  const [iv, setIv] = useState('00000000000000000000000000000000')
  const [ivEnc, setIvEnc] = useState<DataEncoding>('hex')
  const [input, setInput] = useState('hello sm4')
  const [inputEnc, setInputEnc] = useState<DataEncoding>('utf8')
  const [output, setOutput] = useState('')
  const [outputEnc, setOutputEnc] = useState<DataEncoding>('hex')
  const [error, setError] = useState('')

  const execute = () => {
    setError('')
    try {
      const keyBytes = toBytes(key, keyEnc)
      const ivBytes = mode === 'cbc' ? toBytes(iv, ivEnc) : undefined
      if (direction === 'enc') {
        const ct = sm4Encrypt(keyBytes, toBytes(input, inputEnc), mode, ivBytes)
        setOutput(fromBytes(ct, outputEnc))
      } else {
        const pt = sm4Decrypt(keyBytes, toBytes(input, inputEnc), mode, ivBytes)
        setOutput(fromBytes(pt, outputEnc))
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">分组模式</span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as Sm4Mode)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none"
        >
          <option value="ecb">ECB</option>
          <option value="cbc">CBC</option>
        </select>
        <span className="text-[10px] text-muted-foreground">PKCS7 填充</span>
      </div>

      <BytesField
        label="密钥（必须 16 字节）"
        value={key}
        onChange={setKey}
        enc={keyEnc}
        onEnc={setKeyEnc}
        randomSize={16}
        requiredSize={16}
      />

      {mode === 'cbc' && (
        <BytesField
          label="IV（必须 16 字节）"
          value={iv}
          onChange={setIv}
          enc={ivEnc}
          onEnc={setIvEnc}
          randomSize={16}
          requiredSize={16}
        />
      )}

      <DataField
        label={direction === 'enc' ? '明文输入' : '密文输入'}
        value={input}
        onChange={setInput}
        enc={inputEnc}
        onEnc={setInputEnc}
        rows={4}
      />

      <OpRow direction={direction} onChangeDirection={setDir} onExecute={execute} />

      <ErrorBanner error={error} />

      <DataField
        label="输出"
        value={output}
        onChange={() => {}}
        readOnly
        enc={outputEnc}
        onEnc={setOutputEnc}
        rows={4}
      />
    </div>
  )
}
