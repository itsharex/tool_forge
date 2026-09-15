import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, FolderOpen, RefreshCw } from 'lucide-react'
import {
  CheckForensic,
  PickExecutable,
  SaveForensicConfig,
} from '../../../wailsjs/go/main/App'
import type { forensic } from '../../../wailsjs/go/models'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useForensicStore } from '@/stores/forensic'

/**
 * 移动取证的配置弹窗。
 *
 * 原来这些设置在「设置 → 外部工具」里,离用它的地方隔着一次页面跳转 —— 取证页面上
 * 那条"去配置"提示就是个 <Link to="/profile">。配置搬到它服务的页面上之后,
 * 那次跳转就没有了。
 *
 * 分两段是有讲究的:默认 SSH 地址服务于 iOS 取证本身,内置引擎一样要用,
 * 所以它不能跟着 go-forensic 的启用开关一起消失。
 */
export function ConfigDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const binaryPath = useForensicStore((s) => s.binaryPath)
  const setBinaryPath = useForensicStore((s) => s.setBinaryPath)
  const cliEnabled = useForensicStore((s) => s.cliEnabled)
  const setCliEnabled = useForensicStore((s) => s.setCliEnabled)
  const defaultSshAddr = useForensicStore((s) => s.defaultSshAddr)
  const setDefaultSshAddr = useForensicStore((s) => s.setDefaultSshAddr)
  const cache = useForensicStore((s) => s.checkCache)
  const setCheckCache = useForensicStore((s) => s.setCheckCache)

  const [localPath, setLocalPath] = useState(binaryPath)
  const [info, setInfo] = useState<forensic.Info | null>(null)
  const [checking, setChecking] = useState(false)

  // 打开时同步一次:弹窗常开常关,留着上次的输入会让人以为已经保存了
  useEffect(() => {
    if (!open) return
    setLocalPath(binaryPath)
    if (cache && cache.forPath === binaryPath) {
      setInfo({
        found: cache.found,
        path: cache.resolvedPath,
        version: cache.version,
        error: cache.error,
      } as forensic.Info)
    } else {
      setInfo(null)
    }
  }, [open, binaryPath, cache])

  /** 配置整体落盘:前端 store 留一份给界面用,后端也存一份 */
  const persist = async (next: { path: string; enabled: boolean; ssh: string }) => {
    setBinaryPath(next.path)
    setCliEnabled(next.enabled)
    setDefaultSshAddr(next.ssh)
    // 后端那份是给 MCP / 本地 API 用的 —— 它们看不到浏览器的 localStorage
    await SaveForensicConfig({
      binPath: next.path,
      enabled: next.enabled,
      defaultSshAddr: next.ssh,
    } as unknown as never).catch(() => {})
  }

  const saveAndCheck = async () => {
    const path = localPath.trim()
    setChecking(true)
    try {
      const result = (await CheckForensic(path)) as unknown as forensic.Info
      setInfo(result)
      setCheckCache({
        forPath: path,
        found: result.found,
        resolvedPath: result.path,
        version: result.version,
        error: result.error ?? '',
        at: Date.now(),
      })
      // 检测没过就不能留在启用状态 —— 否则界面上摆着一个引擎选项,
      // 点下去必然失败,那个开关等于在撒谎
      await persist({
        path,
        enabled: result.found ? cliEnabled : false,
        ssh: defaultSshAddr,
      })
    } finally {
      setChecking(false)
    }
  }

  const pick = async () => {
    const picked = await PickExecutable('选择 go-forensic 可执行文件').catch(() => '')
    if (picked) setLocalPath(picked)
  }

  const ready = !!info?.found

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="取证配置"
      description="go-forensic 是可选的备选引擎;两个平台的提取都已内置,不装它也能用"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            完成
          </Button>
          <span className="text-[11px] text-muted-foreground">改动即时生效</span>
        </>
      }
    >
      <section className="space-y-1.5">
        <label className="block font-medium text-muted-foreground">默认 iOS SSH 地址</label>
        <input
          value={defaultSshAddr}
          onChange={(e) => {
            setDefaultSshAddr(e.target.value)
            void persist({ path: binaryPath, enabled: cliEnabled, ssh: e.target.value })
          }}
          placeholder="root@127.0.0.1:22"
          spellCheck={false}
          className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="text-[11px] text-muted-foreground">
          新建任务时的默认值。内置引擎走 iOS 时也用它,和下面的 go-forensic 无关。
        </p>
      </section>

      <section className="space-y-3 border-t border-border pt-4">
        <div>
          <div className="font-medium">go-forensic</div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            外部命令行工具。启用后取证页面才会出现引擎选择;不启用就一直走内置实现。
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="block font-medium text-muted-foreground">可执行路径</label>
          <div className="flex gap-2">
            <input
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="留空则在系统 PATH 里找"
              spellCheck={false}
              className="h-9 flex-1 rounded-md border border-input bg-background px-3 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <Button variant="outline" size="sm" onClick={pick}>
              <FolderOpen className="h-3.5 w-3.5" />
              浏览
            </Button>
            <Button size="sm" onClick={() => void saveAndCheck()} disabled={checking}>
              保存并检测
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
          {checking ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              正在检测…
            </span>
          ) : info === null ? (
            <span className="text-muted-foreground">还没检测过,点「保存并检测」试一下</span>
          ) : info.found ? (
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                已就绪
              </div>
              <div className="text-muted-foreground">
                路径：<code className="font-mono">{info.path}</code>
              </div>
              {info.version && (
                <div className="text-muted-foreground">
                  版本：<code className="font-mono">{info.version}</code>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-2 text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{info.error || '未找到 go-forensic'}</span>
            </div>
          )}
        </div>

        {/* 检测不通过就不给开 —— 开关一旦和事实脱节,后面每一次失败都得重新查一遍原因 */}
        <label
          className={cn(
            'flex items-start gap-2',
            ready ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
          )}
        >
          <input
            type="checkbox"
            checked={cliEnabled}
            disabled={!ready}
            onChange={(e) =>
              void persist({ path: binaryPath, enabled: e.target.checked, ssh: defaultSshAddr })
            }
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
          />
          <span>
            启用 go-forensic
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {ready
                ? '取证页面会出现「内置 / go-forensic」选择'
                : '先把上面检测通过才能启用'}
            </span>
          </span>
        </label>
      </section>
    </Dialog>
  )
}
