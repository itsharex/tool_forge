import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToolShell } from '@/components/tool/ToolShell'
import { meta } from './meta'
import { outlookAPI } from './api'
import { GroupPanel } from './GroupPanel'
import { AccountPanel } from './AccountPanel'
import { ImportDialog } from './ImportDialog'
import { AuthSaveDialog } from './AuthSaveDialog'
import { EditAccountDialog } from './EditAccountDialog'
import { ExportDialog } from './ExportDialog'
import { GroupManagerDialog } from './GroupManagerDialog'
import { RefreshManagerDialog } from './RefreshManagerDialog'
import { MailList } from './MailList'
import { MailDetail } from './MailDetail'
import { SettingsDialog } from './SettingsDialog'
import type { AccountView, FolderView, Group, Mail } from './types'

export default function OutlookMailTool() {
  const [groups, setGroups] = useState<Group[]>([])
  const [accounts, setAccounts] = useState<AccountView[]>([])
  const [selectedGroupID, setSelectedGroupID] = useState<string>('')
  const [selectedAccountID, setSelectedAccountID] = useState<string>('')
  const [selectedMail, setSelectedMail] = useState<Mail | null>(null)
  const [folder, setFolder] = useState<FolderView>('all')
  const [selectedIDs, setSelectedIDs] = useState<Set<string>>(new Set())
  const [refreshingIDs, setRefreshingIDs] = useState<Set<string>>(new Set())
  const [showImport, setShowImport] = useState(false)
  const [showAuthSave, setShowAuthSave] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showRefresh, setShowRefresh] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showGroupManager, setShowGroupManager] = useState(false)

  // 宽屏(>= 1100px)下显示独立分组栏,窄屏折叠到账号栏顶部下拉
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const [wideLayout, setWideLayout] = useState(false)
  useEffect(() => {
    const el = layoutRef.current
    if (!el) return
    const update = () => setWideLayout(el.clientWidth >= 1100)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [editTarget, setEditTarget] = useState<AccountView | null>(null)
  const [mailReloadToken, setMailReloadToken] = useState(0)

  const reloadGroups = useCallback(async () => {
    const gs = await outlookAPI.listGroups()
    setGroups(gs)
  }, [])

  const reloadAccounts = useCallback(async () => {
    const list = await outlookAPI.listAccounts('')
    setAccounts(list)
  }, [])

  useEffect(() => {
    void reloadGroups()
    void reloadAccounts()
  }, [reloadGroups, reloadAccounts])

  const filteredAccounts = useMemo(() => {
    if (!selectedGroupID) return accounts
    return accounts.filter((a) => a.group_id === selectedGroupID)
  }, [accounts, selectedGroupID])

  const countsByGroup = useMemo(() => {
    const map: Record<string, number> = {}
    for (const a of accounts) {
      map[a.group_id] = (map[a.group_id] ?? 0) + 1
    }
    return map
  }, [accounts])

  const selectedAccount = useMemo(
    () => filteredAccounts.find((a) => a.id === selectedAccountID) ?? null,
    [filteredAccounts, selectedAccountID],
  )

  // 当切换账号 / 文件夹时清空已选邮件
  useEffect(() => {
    setSelectedMail(null)
  }, [selectedAccountID, folder])

  const toggleSelect = (id: string) => {
    setSelectedIDs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runRefresh = async (ids: string[]) => {
    if (ids.length === 0) return
    setRefreshingIDs(new Set(ids))
    try {
      await outlookAPI.refreshMany(ids)
    } finally {
      setRefreshingIDs(new Set())
      await reloadAccounts()
    }
  }

  const refreshAll = async () => {
    const ids = accounts.filter((a) => !a.disabled).map((a) => a.id)
    await runRefresh(ids)
  }

  const refreshSelected = async () => {
    await runRefresh(Array.from(selectedIDs))
  }

  return (
    <ToolShell
      title={meta.title}
      description={meta.description}
      fullBleed
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>
            <Settings className="h-3.5 w-3.5" />
            设置
          </Button>
        </>
      }
    >
      <div ref={layoutRef} className="flex min-h-0 flex-1">
        {wideLayout && (
          <GroupPanel
            groups={groups}
            selectedID={selectedGroupID}
            countsByGroup={countsByGroup}
            onSelect={setSelectedGroupID}
            onChanged={async () => {
              await reloadGroups()
              await reloadAccounts()
            }}
          />
        )}
        <AccountPanel
          accounts={filteredAccounts}
          groups={groups}
          selectedGroupID={selectedGroupID}
          countsByGroup={countsByGroup}
          onSelectGroup={setSelectedGroupID}
          onOpenGroupManager={() => setShowGroupManager(true)}
          hideGroupSelector={wideLayout}
          selectedID={selectedAccountID}
          selectedIDs={selectedIDs}
          refreshingIDs={refreshingIDs}
          onSelect={(id) => {
            setSelectedAccountID(id)
            setMailReloadToken((n) => n + 1)
          }}
          onToggleSelect={toggleSelect}
          onClearSelection={() => setSelectedIDs(new Set())}
          onOpenImport={() => setShowImport(true)}
          onOpenAuthSave={() => setShowAuthSave(true)}
          onOpenExport={() => setShowExport(true)}
          onOpenRefreshManager={() => setShowRefresh(true)}
          onEditAccount={setEditTarget}
          onRefreshAll={refreshAll}
          onRefreshSelected={refreshSelected}
          onAfterChange={reloadAccounts}
        />
        <MailList
          accountID={selectedAccountID}
          folder={folder}
          selectedMailID={selectedMail?.id ?? ''}
          onSelectMail={setSelectedMail}
          onChangeFolder={setFolder}
          reloadToken={mailReloadToken}
        />
        <MailDetail
          accountEmail={selectedAccount?.email ?? ''}
          accountID={selectedAccountID}
          mail={selectedMail}
        />
      </div>

      {showImport && (
        <ImportDialog
          groups={groups}
          defaultGroupID={selectedGroupID || 'default'}
          onClose={() => setShowImport(false)}
          onImported={() => {
            void reloadAccounts()
          }}
        />
      )}
      {showAuthSave && (
        <AuthSaveDialog
          groups={groups}
          defaultGroupID={selectedGroupID || 'default'}
          onClose={() => setShowAuthSave(false)}
          onSaved={() => {
            void reloadAccounts()
          }}
        />
      )}
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      {showRefresh && (
        <RefreshManagerDialog
          totalAccounts={accounts.length}
          onClose={() => setShowRefresh(false)}
          onAfterRefresh={reloadAccounts}
        />
      )}
      {editTarget && (
        <EditAccountDialog
          account={editTarget}
          groups={groups}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            void reloadAccounts()
          }}
          onDeleted={() => {
            if (selectedAccountID === editTarget.id) setSelectedAccountID('')
            void reloadAccounts()
          }}
        />
      )}
      {showSettings && (
        <SettingsDialog onClose={() => setShowSettings(false)} onSaved={() => undefined} />
      )}
      {showGroupManager && (
        <GroupManagerDialog
          groups={groups}
          countsByGroup={countsByGroup}
          onClose={() => setShowGroupManager(false)}
          onChanged={async () => {
            await reloadGroups()
            await reloadAccounts()
          }}
        />
      )}
    </ToolShell>
  )
}
