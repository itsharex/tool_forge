package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"tool_forge/backend/system"
	"tool_forge/backend/tools/charles"
	"tool_forge/backend/tools/forensic"
	"tool_forge/backend/updater"
)

// AppVersion 应用版本号，随 wails.json 同步维护
const AppVersion = "0.1.3"

// AppInfo 应用元信息
type AppInfo struct {
	Version   string `json:"version"`
	GoVersion string `json:"goVersion"`
	OS        string `json:"os"`
	Arch      string `json:"arch"`
	WailsVer  string `json:"wailsVersion"`
}

// App struct
type App struct {
	ctx      context.Context
	forensic *forensic.Service
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		forensic: forensic.New(),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.forensic.SetContext(ctx)
}

// GetAppInfo 返回应用与运行环境信息
func (a *App) GetAppInfo() AppInfo {
	return AppInfo{
		Version:   AppVersion,
		GoVersion: runtime.Version(),
		OS:        runtime.GOOS,
		Arch:      runtime.GOARCH,
		WailsVer:  "v2.11.0",
	}
}

// ================ Charles ================

// GenerateCharlesKey 根据名称生成 Charles 激活码
func (a *App) GenerateCharlesKey(name string) string {
	return charles.Generate(name)
}

// ================ Forensic ================

// CheckForensic 探测 go-forensic 可执行文件（自定义路径可为空，为空则走 PATH）
func (a *App) CheckForensic(customPath string) forensic.Info {
	return a.forensic.Check(customPath)
}

// SetForensicBinaryPath 配置 go-forensic 路径
func (a *App) SetForensicBinaryPath(path string) {
	a.forensic.SetBinaryPath(path)
}

// RunForensic 启动取证命令，返回 jobID；后续通过 forensic:log / forensic:done 事件推送
func (a *App) RunForensic(args []string) (string, error) {
	return a.forensic.Run(args)
}

// CancelForensic 取消正在执行的任务
func (a *App) CancelForensic(jobID string) error {
	return a.forensic.Cancel(jobID)
}

// ================ System ================

// PickExecutable 选择一个可执行文件
func (a *App) PickExecutable(title string) (string, error) {
	return system.PickFile(a.ctx, system.PickFileOptions{
		Title:       title,
		Extensions:  []string{".exe"},
		DisplayName: "可执行文件",
	})
}

// PickDirectory 选择一个目录
func (a *App) PickDirectory(title, defaultPath string) (string, error) {
	return system.PickDirectory(a.ctx, title, defaultPath)
}

// OpenInExplorer 在系统文件管理器中打开路径
func (a *App) OpenInExplorer(path string) error {
	return system.OpenInExplorer(path)
}

// SavePassword 将密码写入系统凭据库
func (a *App) SavePassword(key, value string) error {
	return system.SavePassword(key, value)
}

// GetPassword 从系统凭据库读取密码
func (a *App) GetPassword(key string) (string, error) {
	return system.GetPassword(key)
}

// DeletePassword 从系统凭据库删除密码
func (a *App) DeletePassword(key string) error {
	return system.DeletePassword(key)
}

// ================ Updater ================

// CheckUpdate 对比 Hub manifest 与本地版本
func (a *App) CheckUpdate() (*updater.CheckResult, error) {
	return updater.Check(a.ctx, AppVersion)
}

// DownloadUpdate 下载 manifest 指向的新版到 Downloads,期间通过
// Wails 事件 "update:download-progress" 推送进度
func (a *App) DownloadUpdate(m updater.Manifest) (*updater.DownloadResult, error) {
	return updater.Download(a.ctx, a.ctx, m)
}

// QuitForUpdate 仅仅关闭 app(不启动新 exe)——
// 给用户"我先手动处理"的口子,通常不走这条。
func (a *App) QuitForUpdate() {
	wailsruntime.Quit(a.ctx)
}

// InstallAndRestart 一键安装:
//  1. 后台 detached 启动 Downloads 里的新 exe
//  2. 500ms 后关闭当前 app,让新 exe 完成自搬家流程
//
// 新 exe 里的 HandleStartup 有 4 次重试(总 ~3 秒),足够容忍我们这边的优雅退出。
func (a *App) InstallAndRestart(downloadedPath string) error {
	cmd := exec.Command(downloadedPath)
	cmd.SysProcAttr = detachedSysProcAttr()
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() {
		time.Sleep(500 * time.Millisecond)
		wailsruntime.Quit(a.ctx)
	}()
	return nil
}

// OpenDownloadsFolder 方便用户找刚下载的 exe
func (a *App) OpenDownloadsFolder() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	return system.OpenInExplorer(filepath.Join(home, "Downloads"))
}
