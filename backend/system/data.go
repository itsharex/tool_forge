package system

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// DataStats 是个人主页 → 数据 页面要展示的本地数据概览
type DataStats struct {
	DataDir       string `json:"dataDir"`
	TotalBytes    int64  `json:"totalBytes"`
	TotalFiles    int    `json:"totalFiles"`
	ClipboardDir  string `json:"clipboardDir"`
	ClipboardSize int64  `json:"clipboardSize"`
	ClipboardImgs int    `json:"clipboardImgs"`
	HasHotkeys    bool   `json:"hasHotkeys"`
}

// ToolforgeDir 返回 ~/.toolforge,空字符串表示无法定位 home
func ToolforgeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".toolforge")
}

// CollectDataStats 扫描 ~/.toolforge,统计文件数 / 总字节 + 剪贴板细分
func CollectDataStats() (*DataStats, error) {
	dir := ToolforgeDir()
	stats := &DataStats{DataDir: dir}
	if dir == "" {
		return stats, nil
	}
	stats.ClipboardDir = filepath.Join(dir, "clipboard")
	clipImgDir := filepath.Join(stats.ClipboardDir, "images")
	hotkeyPath := filepath.Join(dir, "hotkeys.json")

	if _, err := os.Stat(hotkeyPath); err == nil {
		stats.HasHotkeys = true
	}
	// 整目录大小 + 文件数
	if _, err := os.Stat(dir); err == nil {
		_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			stats.TotalBytes += info.Size()
			stats.TotalFiles++
			if strings.HasPrefix(path, stats.ClipboardDir) {
				stats.ClipboardSize += info.Size()
			}
			return nil
		})
	}
	if _, err := os.Stat(clipImgDir); err == nil {
		entries, _ := os.ReadDir(clipImgDir)
		stats.ClipboardImgs = len(entries)
	}
	return stats, nil
}

// OpenDataDir 调系统资源管理器打开 ~/.toolforge
func OpenDataDir() error {
	dir := ToolforgeDir()
	if dir == "" {
		return fmt.Errorf("无法定位 home 目录")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return OpenInExplorer(dir)
}

// ResetAllData 删除整个 ~/.toolforge 目录,需要调用方提前 Stop 各 service
func ResetAllData() error {
	dir := ToolforgeDir()
	if dir == "" {
		return fmt.Errorf("无法定位 home 目录")
	}
	if _, err := os.Stat(dir); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	return os.RemoveAll(dir)
}

// ExportData 把 ~/.toolforge 整目录 + 前端传来的 localStorage 一起打成 zip。
// 用户通过原生 Save 对话框选输出位置。返回最终 zip 路径(取消时返回空字符串、err nil)。
func ExportData(ctx context.Context, localStorageJSON string) (string, error) {
	defaultName := fmt.Sprintf("toolforge-backup-%s.zip", time.Now().Format("20060102-150405"))
	savePath, err := wailsruntime.SaveFileDialog(ctx, wailsruntime.SaveDialogOptions{
		Title:                "导出 Tool Forge 本地数据",
		DefaultFilename:      defaultName,
		CanCreateDirectories: true,
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "ZIP 文件 (*.zip)", Pattern: "*.zip"},
		},
	})
	if err != nil {
		return "", err
	}
	if savePath == "" {
		return "", nil
	}
	f, err := os.Create(savePath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	zw := zip.NewWriter(f)
	defer zw.Close()

	// manifest
	manifest := map[string]any{
		"app":         "tool-forge",
		"exported_at": time.Now().Format(time.RFC3339),
		"version":     1,
	}
	if w, err := zw.Create("manifest.json"); err == nil {
		_ = json.NewEncoder(w).Encode(manifest)
	}

	// localStorage 单独存一个 json
	if localStorageJSON != "" {
		if w, err := zw.Create("localstorage.json"); err == nil {
			_, _ = w.Write([]byte(localStorageJSON))
		}
	}

	// 把 ~/.toolforge 整目录写到 zip 的 toolforge/ 下
	dir := ToolforgeDir()
	if dir != "" {
		if _, err := os.Stat(dir); err == nil {
			err = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
				if err != nil {
					return nil
				}
				if d.IsDir() {
					return nil
				}
				rel, _ := filepath.Rel(dir, path)
				rel = filepath.ToSlash(rel)
				w, err := zw.Create(filepath.ToSlash(filepath.Join("toolforge", rel)))
				if err != nil {
					return err
				}
				src, err := os.Open(path)
				if err != nil {
					return nil
				}
				defer src.Close()
				_, _ = io.Copy(w, src)
				return nil
			})
			if err != nil {
				return "", err
			}
		}
	}
	return savePath, nil
}

// ImportData 让用户选 zip,然后:
//   1. 把 zip 里 toolforge/* 解到 ~/.toolforge(覆盖)
//   2. 把 zip 里 localstorage.json 内容直接返回给前端,前端自行写回 localStorage
//
// 返回值: (localStorageJSON string, error)。用户取消选文件时返回 ("","")。
// 调用方应该提前 Stop 各 service 避免文件锁。
func ImportData(ctx context.Context) (string, error) {
	pickedPath, err := wailsruntime.OpenFileDialog(ctx, wailsruntime.OpenDialogOptions{
		Title: "选择 Tool Forge 备份文件",
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "ZIP 文件 (*.zip)", Pattern: "*.zip"},
		},
	})
	if err != nil {
		return "", err
	}
	if pickedPath == "" {
		return "", nil
	}
	zr, err := zip.OpenReader(pickedPath)
	if err != nil {
		return "", err
	}
	defer zr.Close()

	dir := ToolforgeDir()
	if dir == "" {
		return "", fmt.Errorf("无法定位 home 目录")
	}
	// 先清空 ~/.toolforge,再展开,避免老数据混入
	_ = os.RemoveAll(dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}

	var localStorageJSON string
	for _, f := range zr.File {
		name := filepath.ToSlash(f.Name)
		if name == "localstorage.json" {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			data, _ := io.ReadAll(rc)
			rc.Close()
			localStorageJSON = string(data)
			continue
		}
		const prefix = "toolforge/"
		if !strings.HasPrefix(name, prefix) {
			continue
		}
		rel := strings.TrimPrefix(name, prefix)
		if rel == "" || strings.Contains(rel, "..") {
			continue
		}
		dest := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		out, err := os.Create(dest)
		if err != nil {
			rc.Close()
			continue
		}
		_, _ = io.Copy(out, rc)
		out.Close()
		rc.Close()
	}
	return localStorageJSON, nil
}
