// Package updater 负责 Tool Forge 的更新检查、下载、自搬家。
package updater

import "time"

// ManifestURL 指向 Hub 上托管的 Tool Forge manifest
const ManifestURL = "https://hub.jntml.me/api/public/apps/tool-forge/manifest.json"

// DownloadPrefix 下载到 Downloads 时用的文件名前缀；自搬家判断也看这个
const DownloadPrefix = "ToolForge-v"

// Manifest 与 Hub 侧 public.ManifestBody 对齐
type Manifest struct {
	Slug        string    `json:"slug"`
	Version     string    `json:"version"`
	Channel     string    `json:"channel"`
	ReleasedAt  time.Time `json:"released_at"`
	DownloadURL string    `json:"download_url"`
	SHA256      string    `json:"sha256"`
	SizeBytes   int64     `json:"size_bytes"`
	Changelog   string    `json:"changelog"`
	IsCritical  bool      `json:"is_critical"`
}

// CheckResult 返回给前端用于 UI 渲染
type CheckResult struct {
	CurrentVersion string    `json:"current_version"`
	LatestVersion  string    `json:"latest_version"`
	HasUpdate      bool      `json:"has_update"`
	Manifest       *Manifest `json:"manifest,omitempty"`
	CheckedAt      time.Time `json:"checked_at"`
}

// DownloadResult 下载完成后的结果
type DownloadResult struct {
	LocalPath string `json:"local_path"`
	Version   string `json:"version"`
	SHA256    string `json:"sha256"`
	Size      int64  `json:"size"`
}

// DownloadProgress 通过 Wails 事件 "update:download-progress" 推送
type DownloadProgress struct {
	Loaded  int64 `json:"loaded"`
	Total   int64 `json:"total"`
	Percent int   `json:"percent"`
}
