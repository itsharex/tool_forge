// Package system 提供文件对话框、凭据管理、打开资源管理器等系统能力。
package system

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	
)

const keyringService = "tool-forge"

// PickFileOptions 文件选择对话框选项
type PickFileOptions struct {
	Title           string   `json:"title"`
	Extensions      []string `json:"extensions"`  // 例如 [".exe"]
	DisplayName     string   `json:"displayName"` // 过滤器显示名，例如 "可执行文件"
	DefaultPath     string   `json:"defaultPath"`
	DefaultFilename string   `json:"defaultFilename"` // 仅保存对话框用
}

// PickFile 弹出原生文件选择对话框
func PickFile(ctx context.Context, opts PickFileOptions) (string, error) {
	filters := []wailsruntime.FileFilter{}
	if len(opts.Extensions) > 0 {
		pattern := ""
		for i, ext := range opts.Extensions {
			if i > 0 {
				pattern += ";"
			}
			pattern += "*" + ext
		}
		label := opts.DisplayName
		if label == "" {
			label = "文件"
		}
		filters = append(filters, wailsruntime.FileFilter{
			DisplayName: fmt.Sprintf("%s (%s)", label, pattern),
			Pattern:     pattern,
		})
	}
	return wailsruntime.OpenFileDialog(ctx, wailsruntime.OpenDialogOptions{
		Title:                opts.Title,
		Filters:              filters,
		DefaultDirectory:     opts.DefaultPath,
		CanCreateDirectories: false,
	})
}

// PickSaveFile 弹出原生保存对话框,返回用户选定的目标路径。
func PickSaveFile(ctx context.Context, opts PickFileOptions) (string, error) {
	filters := []wailsruntime.FileFilter{}
	if len(opts.Extensions) > 0 {
		pattern := ""
		for i, ext := range opts.Extensions {
			if i > 0 {
				pattern += ";"
			}
			pattern += "*" + ext
		}
		label := opts.DisplayName
		if label == "" {
			label = "文件"
		}
		filters = append(filters, wailsruntime.FileFilter{
			DisplayName: fmt.Sprintf("%s (%s)", label, pattern),
			Pattern:     pattern,
		})
	}
	return wailsruntime.SaveFileDialog(ctx, wailsruntime.SaveDialogOptions{
		Title:                opts.Title,
		Filters:              filters,
		DefaultDirectory:     opts.DefaultPath,
		DefaultFilename:      opts.DefaultFilename,
		CanCreateDirectories: true,
	})
}

// PickDirectory 弹出原生目录选择对话框
func PickDirectory(ctx context.Context, title, defaultPath string) (string, error) {
	return wailsruntime.OpenDirectoryDialog(ctx, wailsruntime.OpenDialogOptions{
		Title:                title,
		DefaultDirectory:     defaultPath,
		CanCreateDirectories: true,
	})
}

// OpenInExplorer 调系统文件管理器打开指定路径。
// 支持 ~ 展开为用户主目录。
func OpenInExplorer(path string) error {
	if path == "" {
		return fmt.Errorf("空路径")
	}
	if strings.HasPrefix(path, "~") {
		if home, err := os.UserHomeDir(); err == nil {
			path = filepath.Join(home, strings.TrimPrefix(path, "~"))
		}
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", path)
	case "darwin":
		cmd = exec.Command("open", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}
	return cmd.Start()
}

// SavePassword 将密码写入系统凭据库（Windows Credential Manager / macOS Keychain / Linux Secret Service）
func SavePassword(key, value string) error {
	return keyring.Set(keyringService, key, value)
}

// GetPassword 读取密码；不存在时返回空字符串 + nil
func GetPassword(key string) (string, error) {
	v, err := keyring.Get(keyringService, key)
	if err != nil {
		if err == keyring.ErrNotFound {
			return "", nil
		}
		return "", err
	}
	return v, nil
}

// DeletePassword 删除凭据
func DeletePassword(key string) error {
	err := keyring.Delete(keyringService, key)
	if err == keyring.ErrNotFound {
		return nil
	}
	return err
}
