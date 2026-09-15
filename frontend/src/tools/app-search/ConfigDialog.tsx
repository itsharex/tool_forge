import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { HasQimaiPhpSessID, SaveQimaiPhpSessID } from '../../../wailsjs/go/main/App'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'

/**
 * 包名搜索的配置弹窗:目前只有七麦登录态。
 *
 * 原来这个设置在「设置 → 外部工具」里,而这个页面对它一无所知 —— 没配的表现是
 * 搜完出现一个小红药丸,原因只写在 tooltip 里。搬过来之后,配置和用它的地方在同一屏。
 */
export function ConfigDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  /** 配置变了通知外面刷新状态 —— 源列表上的提示要跟着变 */
  onChanged: () => void
}) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)

  const refresh = async () => {
    try {
      setConfigured((await HasQimaiPhpSessID()) as unknown as boolean)
    } catch {
      setConfigured(false)
    }
  }

  useEffect(() => {
    if (open) void refresh()
  }, [open])

  const write = async (next: string) => {
    setSaving(true)
    try {
      await SaveQimaiPhpSessID(next)
      setValue('')
      await refresh()
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="包名搜索配置"
      description="只有七麦 Android 源需要配置;其余几个源开箱即用"
      width="w-[560px]"
      footer={
        <Button size="sm" onClick={onClose}>
          完成
        </Button>
      }
    >
      <section className="space-y-3">
        <div>
          <div className="font-medium">七麦登录态</div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            登录 www.qimai.cn 后,在浏览器 DevTools 里复制{' '}
            <code className="font-mono">PHPSESSID</code> 的值贴进来。
            整条 Cookie 一起贴也认 —— 从 DevTools 里整条复制比单独挑一个字段容易。
            (iOS 那几个源是公开数据,不配也能用。)
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            内容存进系统凭据库(Windows 凭据管理器 / macOS 钥匙串),不明文落盘,也不会发给我们。
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="block font-medium text-muted-foreground">Cookie</label>
          <div className="flex gap-2">
            <input
              type={show ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={configured ? '已保存,贴入新的覆盖' : 'PHPSESSID 的值,或整条 Cookie'}
              spellCheck={false}
              className="h-9 flex-1 rounded-md border border-input bg-background px-3 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setShow((v) => !v)}
              title={show ? '隐藏' : '显示'}
            >
              {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
            <Button
              size="sm"
              onClick={() => void write(value.trim())}
              disabled={saving || value.trim().length === 0}
            >
              保存
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border border-dashed border-border bg-muted/30 p-3">
          {configured === null ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              检测中…
            </span>
          ) : configured ? (
            <span className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              已保存在系统凭据库
            </span>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5" />
              未配置,七麦 Android 源用不了
            </span>
          )}
          {configured && (
            <button
              onClick={() => void write('')}
              disabled={saving}
              className="text-muted-foreground underline-offset-2 transition-colors hover:text-destructive hover:underline"
            >
              清除
            </button>
          )}
        </div>

        {/* 过期的表现不是报错,而是一直搜出 0 条 —— 这一点不写出来,
            用户只会以为是关键词打错了 */}
        <p className="text-[11px] text-muted-foreground">
          登录态会过期,而七麦对此不报错 —— 表现就是搜索一直返回 0 条。
          真过期了结果区会直接说,回这里重新贴一次即可。
        </p>
      </section>
    </Dialog>
  )
}
