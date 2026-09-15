package forensic

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// go-forensic 的配置落盘。
//
// 以前这个路径只活在内存里,靠移动取证页面 mount 时推下来。于是用户只要没打开过那个页面,
// 后端拿到的就是空值 —— MCP / 本地 API 那条路无从得知用户配过什么,只能退回 PATH 查找,
// 而装在别处的 go-forensic 就这么"配了等于没配"。

// Config 持久化到 ~/.toolforge/forensic.json
type Config struct {
	// BinPath go-forensic 可执行文件路径;空 = 在 PATH 里找
	BinPath string `json:"binPath,omitempty"`
	// Enabled 用户是否启用了 go-forensic 这个备选引擎。
	//
	// 只影响界面给不给引擎选择入口 —— 后端不拿它拦 --engine=cli:
	// agent 显式点名要用 CLI 时,它比界面上的开关更清楚自己要什么。
	Enabled bool `json:"enabled,omitempty"`
	// DefaultSSHAddr iOS 取证的默认 SSH 地址。
	// 放这儿而不是 go-forensic 名下:内置引擎走 iOS 时同样要用
	DefaultSSHAddr string `json:"defaultSshAddr,omitempty"`
}

func configPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	d := filepath.Join(home, ".toolforge")
	if err := os.MkdirAll(d, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(d, "forensic.json"), nil
}

// LoadConfig 读配置;文件不存在返回零值而不是错误
func LoadConfig() (Config, error) {
	p, err := configPath()
	if err != nil {
		return Config{}, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return Config{}, nil
		}
		return Config{}, err
	}
	if len(data) == 0 {
		return Config{}, nil
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		return Config{}, err
	}
	return c, nil
}

// SaveConfig 落盘
func SaveConfig(c Config) error {
	p, err := configPath()
	if err != nil {
		return err
	}
	c.BinPath = strings.TrimSpace(c.BinPath)
	c.DefaultSSHAddr = strings.TrimSpace(c.DefaultSSHAddr)
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o644)
}

// Config 返回当前配置(含内存里那份 binPath)
func (s *Service) Config() Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.config
}

// SetConfig 覆盖配置并落盘;binPath 同时同步到内存,供 runCLI 解析
func (s *Service) SetConfig(c Config) error {
	c.BinPath = strings.TrimSpace(c.BinPath)
	c.DefaultSSHAddr = strings.TrimSpace(c.DefaultSSHAddr)
	s.mu.Lock()
	s.config = c
	s.binPath = c.BinPath
	s.mu.Unlock()
	return SaveConfig(c)
}

// restoreConfig 启动时把落盘的配置读回内存。
// 读失败不算致命 —— 大不了退回 PATH 查找,不该因为一个配置文件坏了就起不来
func (s *Service) restoreConfig() {
	c, err := LoadConfig()
	if err != nil {
		return
	}
	s.mu.Lock()
	s.config = c
	s.binPath = c.BinPath
	s.mu.Unlock()
}
