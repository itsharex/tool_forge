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

// ModuleStorage 单个工具模块在 ~/.toolforge 下的占用情况;
// 数据页"模块占用"区按这个列表渲染,不在前端硬编码模块清单
type ModuleStorage struct {
	Key     string `json:"key"`               // 稳定标识(供前端图标/i18n 用)
	Label   string `json:"label"`             // 中文展示名
	Path    string `json:"path"`              // 完整路径(可能是目录或单文件)
	IsDir   bool   `json:"isDir"`             // true=目录,false=单文件
	Bytes   int64  `json:"bytes"`             // 占用字节
	Files   int    `json:"files"`             // 文件数(单文件 = 1)
	Exists  bool   `json:"exists"`            // 路径是否存在(不存在仍展示为 0)
	SubInfo string `json:"subInfo,omitempty"` // 额外信息,如"32 张图片"/"5 个会话"
}

// DataStats 是个人主页 → 数据 页面要展示的本地数据概览
type DataStats struct {
	DataDir    string          `json:"dataDir"`
	TotalBytes int64           `json:"totalBytes"`
	TotalFiles int             `json:"totalFiles"`
	Modules    []ModuleStorage `json:"modules"`
	HasHotkeys bool            `json:"hasHotkeys"`
}

// ToolforgeDir 返回 ~/.toolforge,空字符串表示无法定位 home
func ToolforgeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".toolforge")
}

// CollectDataStats 扫描 ~/.toolforge,统计总占用 + 每个模块的占用
func CollectDataStats() (*DataStats, error) {
	dir := ToolforgeDir()
	stats := &DataStats{DataDir: dir}
	if dir == "" {
		return stats, nil
	}

	// 整目录大小 + 文件数
	if _, err := os.Stat(dir); err == nil {
		_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			stats.TotalBytes += info.Size()
			stats.TotalFiles++
			return nil
		})
	}

	hotkeyPath := filepath.Join(dir, "hotkeys.json")
	if _, err := os.Stat(hotkeyPath); err == nil {
		stats.HasHotkeys = true
	}

	// 模块定义:稳定的 key + 中文 label + 相对路径 + 是否目录 + 可选的 subInfo
	type modDef struct {
		key, label, rel string
		isDir           bool
		subInfo         func(path string) string
	}
	defs := []modDef{
		{"ai-chat", "AI 对话", "ai-chat", true, aiChatSubInfo},
		{"clipboard", "剪贴板历史", "clipboard", true, clipboardSubInfo},
		{"http-test", "HTTP 测试历史", "http-history.json", false, nil},
		{"provider-switch", "Provider 切换配置", "providers.json", false, nil},
		{"hotkeys", "全局热键", "hotkeys.json", false, nil},
	}
	stats.Modules = make([]ModuleStorage, 0, len(defs))
	for _, m := range defs {
		full := filepath.Join(dir, m.rel)
		ms := ModuleStorage{Key: m.key, Label: m.label, Path: full, IsDir: m.isDir}
		if info, err := os.Stat(full); err == nil {
			ms.Exists = true
			if m.isDir {
				ms.Bytes, ms.Files = walkSize(full)
			} else {
				ms.Bytes = info.Size()
				ms.Files = 1
			}
			if m.subInfo != nil {
				ms.SubInfo = m.subInfo(full)
			}
		}
		stats.Modules = append(stats.Modules, ms)
	}
	return stats, nil
}

func walkSize(dir string) (int64, int) {
	var b int64
	var f int
	_ = filepath.WalkDir(dir, func(_ string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		info, _ := d.Info()
		if info != nil {
			b += info.Size()
			f++
		}
		return nil
	})
	return b, f
}

func aiChatSubInfo(dir string) string {
	convDir := filepath.Join(dir, "conversations")
	entries, _ := os.ReadDir(convDir)
	n := 0
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			n++
		}
	}
	if n == 0 {
		return ""
	}
	return fmt.Sprintf("%d 个会话", n)
}

func clipboardSubInfo(dir string) string {
	imgDir := filepath.Join(dir, "images")
	entries, _ := os.ReadDir(imgDir)
	if len(entries) == 0 {
		return ""
	}
	return fmt.Sprintf("%d 张图片", len(entries))
}

// ClearModuleData 清空某个模块的数据(单文件 = 删文件;目录 = removeAll + 重建空目录)。
// 调用方需要保证相关 service 已停止/可容忍数据消失,否则可能再次写回。
func ClearModuleData(key string) error {
	dir := ToolforgeDir()
	if dir == "" {
		return fmt.Errorf("无法定位 home 目录")
	}
	stats, _ := CollectDataStats()
	if stats == nil {
		return fmt.Errorf("无法读取数据状态")
	}
	for _, m := range stats.Modules {
		if m.Key != key {
			continue
		}
		if !m.Exists {
			return nil
		}
		if m.IsDir {
			if err := os.RemoveAll(m.Path); err != nil {
				return err
			}
			return os.MkdirAll(m.Path, 0o755)
		}
		return os.Remove(m.Path)
	}
	return fmt.Errorf("未知模块: %s", key)
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
//  1. 把 zip 里 toolforge/* 解到 ~/.toolforge(覆盖)
//  2. 把 zip 里 localstorage.json 内容直接返回给前端,前端自行写回 localStorage
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
