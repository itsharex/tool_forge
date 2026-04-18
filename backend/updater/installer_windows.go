//go:build windows

package updater

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows/registry"
)

// debugLog 写到 %USERPROFILE%\tool-forge-updater.log;
// 仅当环境变量 TOOLFORGE_UPDATER_DEBUG 为 1/true/yes/on 时才启用,
// 避免日志文件无声无息地增长到用户目录。
//
// 用户遇到更新问题时,临时 `set TOOLFORGE_UPDATER_DEBUG=1` 再复现即可拿到日志。
func debugLog(format string, args ...any) {
	if !isDebugEnabled() {
		return
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(home, "tool-forge-updater.log"),
		os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "[%s] %s\n", time.Now().Format("2006-01-02 15:04:05"), fmt.Sprintf(format, args...))
}

func isDebugEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("TOOLFORGE_UPDATER_DEBUG"))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

const (
	regPath  = `Software\ToolForge`
	regValue = "InstallPath"
)

// HandleStartup 在 main() 早期调用。
//
// 策略:
//   - 若当前 exe **不在** Downloads(即"正常安装位置"),写注册表保存当前路径,继续启动
//   - 若当前 exe **在** Downloads 且文件名是 ToolForge-v*.exe(说明是我们的下载产物),
//     尝试"自搬家"到注册表中的 InstallPath → 启动那边 → 本进程 exit
//   - 自搬家失败(例如旧 exe 正被占用、注册表无记录)→ 退化为普通启动,让用户直接用 Downloads 的
func HandleStartup() {
	exePath, err := os.Executable()
	if err != nil {
		debugLog("[ERR] os.Executable failed: %v", err)
		return
	}
	exePath, _ = filepath.Abs(exePath)
	debugLog("[START] exePath=%s", exePath)

	// 只有我们自己的 exe 才处理:过滤掉 wails build 的 wailsbindings.exe 等辅助进程
	base := strings.ToLower(filepath.Base(exePath))
	if !strings.HasPrefix(base, "toolforge") {
		debugLog("skip: not our exe (%s)", base)
		return
	}

	inDL := isInDownloads(exePath)
	debugLog("isInDownloads=%v", inDL)

	if !inDL {
		if err := writeInstallPath(exePath); err != nil {
			debugLog("[WARN] writeInstallPath err: %v", err)
		} else {
			debugLog("writeInstallPath ok: %s", exePath)
		}
		return
	}

	// 在 Downloads 里
	debugLog("basename lower=%s, prefix=%s", base, strings.ToLower(DownloadPrefix))
	if !strings.HasPrefix(base, strings.ToLower(DownloadPrefix)) || !strings.HasSuffix(base, ".exe") {
		debugLog("not our naming pattern, skip relocate")
		return
	}

	installPath, err := readInstallPath()
	if err != nil || installPath == "" {
		debugLog("[WARN] readInstallPath err=%v path=%q -> skip relocate", err, installPath)
		return
	}
	debugLog("installPath from reg: %s", installPath)

	if fi, err := os.Stat(installPath); err != nil {
		debugLog("[WARN] Stat installPath err: %v", err)
		return
	} else {
		debugLog("old install size=%d mtime=%s", fi.Size(), fi.ModTime())
	}

	// 经典自更新套路:先把老 exe 改名成 .old,再把新 exe 复制到原位置。
	// 改名对"被杀软扫描"、"被 Explorer 缩略图缓存占用"比"直接打开写入"容错性高。
	backup := installPath + ".old"
	_ = os.Remove(backup) // 清理可能存在的历史 .old

	renamed := false
	if err := os.Rename(installPath, backup); err == nil {
		renamed = true
		debugLog("renamed old -> %s", backup)
	} else {
		debugLog("[INFO] rename old failed (%v), will fall back to direct copy with retries", err)
	}

	// 写入新 exe,带 4 次指数退避重试(0s / 500ms / 1s / 1.5s)
	var copyErr error
	for i := 0; i < 4; i++ {
		if i > 0 {
			wait := time.Duration(500*i) * time.Millisecond
			debugLog("copyFile retry #%d after %s", i, wait)
			time.Sleep(wait)
		}
		copyErr = copyFile(exePath, installPath)
		if copyErr == nil {
			break
		}
	}
	if copyErr != nil {
		debugLog("[ERR] copyFile failed after retries: %v", copyErr)
		if renamed {
			if restoreErr := os.Rename(backup, installPath); restoreErr != nil {
				debugLog("[ERR] cannot restore original from .old: %v", restoreErr)
			}
		}
		return
	}
	debugLog("copyFile OK -> %s (rename backup: %v)", installPath, renamed)

	// 启动新 exe,延迟删除 Downloads 副本 + .old 备份(如有)
	if err := launchAndCleanup(installPath, exePath); err != nil {
		debugLog("[ERR] launchAndCleanup failed: %v", err)
		return
	}
	debugLog("launchAndCleanup spawned, exiting self")
	os.Exit(0)
}

func isInDownloads(p string) bool {
	home, err := os.UserHomeDir()
	if err == nil {
		dl := filepath.Join(home, "Downloads")
		if hasPathPrefix(p, dl) {
			return true
		}
	}
	// Fallback:路径里含 \Downloads\ 片段
	return strings.Contains(strings.ToLower(p), `\downloads\`)
}

func hasPathPrefix(p, prefix string) bool {
	pa, _ := filepath.Abs(p)
	pb, _ := filepath.Abs(prefix)
	pa = strings.ToLower(pa)
	pb = strings.ToLower(pb)
	if !strings.HasSuffix(pb, string(filepath.Separator)) {
		pb += string(filepath.Separator)
	}
	return strings.HasPrefix(pa, pb)
}

func writeInstallPath(path string) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, regPath, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.SetStringValue(regValue, path)
}

func readInstallPath() (string, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, regPath, registry.QUERY_VALUE)
	if err != nil {
		return "", err
	}
	defer k.Close()
	v, _, err := k.GetStringValue(regValue)
	return v, err
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

// launchAndCleanup 通过 VBScript + wscript.exe 完成清理和重启:
//   - wscript 是 GUI 解释器,没有控制台窗口,从根上避免闪黑窗
//   - WScript.Sleep 做延迟,不依赖控制台
//   - FileSystemObject.DeleteFile 对被索引/缩略图服务占用的文件容错更好
func launchAndCleanup(launchPath, deletePath string) error {
	vbsPath := filepath.Join(os.TempDir(), "toolforge-updater.vbs")
	vbs := fmt.Sprintf(`On Error Resume Next
WScript.Sleep 2000
Set fso = CreateObject("Scripting.FileSystemObject")
fso.DeleteFile %q, True
fso.DeleteFile %q, True
CreateObject("WScript.Shell").Run Chr(34) & %q & Chr(34), 1, False
Set fso2 = CreateObject("Scripting.FileSystemObject")
fso2.DeleteFile WScript.ScriptFullName, True
`, deletePath, launchPath+".old", launchPath)

	if err := os.WriteFile(vbsPath, []byte(vbs), 0o644); err != nil {
		return err
	}

	cmd := exec.Command("wscript.exe", "//Nologo", vbsPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}
