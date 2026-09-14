package codexinsight

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// 可读写的根目录下的顶层配置文件白名单。只允许这些文件名,防止被用作任意文件读写。
var allowedConfigFiles = map[string]bool{
	"AGENTS.md":           true,
	"config.toml":         true,
	"rules/default.rules": true,
}

// ConfigFile 代表一个配置文件的内容与元信息
type ConfigFile struct {
	Name      string `json:"name"` // AGENTS.md / config.toml
	Path      string `json:"path"` // 绝对路径
	Exists    bool   `json:"exists"`
	Content   string `json:"content"`
	Size      int64  `json:"size"`
	UpdatedAt string `json:"updated_at"` // RFC3339
}

// ReadConfigFile 读取 ~/.codex 下指定配置文件的内容。
func ReadConfigFile(codexDir, name string) (*ConfigFile, error) {
	if !allowedConfigFiles[name] {
		return nil, fmt.Errorf("不支持的配置文件: %s", name)
	}
	dir, err := resolveCodexDir(codexDir)
	if err != nil {
		return nil, err
	}
	target := filepath.Join(dir, name)
	cf := &ConfigFile{Name: name, Path: target}
	info, err := os.Stat(target)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return cf, nil // exists=false
		}
		return nil, err
	}
	if info.IsDir() {
		return nil, fmt.Errorf("%s 是目录", name)
	}
	const maxRead = 2 * 1024 * 1024
	if info.Size() > maxRead {
		return nil, fmt.Errorf("文件过大(%d bytes),超过 2 MB", info.Size())
	}
	data, err := os.ReadFile(target)
	if err != nil {
		return nil, err
	}
	cf.Exists = true
	cf.Content = string(data)
	cf.Size = info.Size()
	cf.UpdatedAt = info.ModTime().UTC().Format(time.RFC3339)
	return cf, nil
}

// WriteConfigFile 覆盖/创建 ~/.codex 下指定配置文件。
func WriteConfigFile(codexDir, name, content string) error {
	if !allowedConfigFiles[name] {
		return fmt.Errorf("不支持的配置文件: %s", name)
	}
	dir, err := resolveCodexDir(codexDir)
	if err != nil {
		return err
	}
	const maxWrite = 2 * 1024 * 1024
	if len(content) > maxWrite {
		return fmt.Errorf("内容过大,超过 2 MB")
	}
	target := filepath.Join(dir, name)
	// 允许子目录配置(如 rules/default.rules):确保父目录存在
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	return os.WriteFile(target, []byte(content), 0o644)
}
