package forensic

import (
	"os"
	"path/filepath"
	"testing"
)

// 配置落盘再读回来。
//
// 这条存在的理由:这份配置以前只活在内存里,靠取证页面 mount 时推下来 ——
// 用户没打开过那个页面,后端就不知道 go-forensic 装在哪,MCP 那条路只能退回 PATH。
func TestConfigRoundTrip(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("USERPROFILE", os.Getenv("HOME")) // Windows 上 UserHomeDir 认这个

	want := Config{
		BinPath:        filepath.Join("C:", "tools", "go-forensic.exe"),
		Enabled:        true,
		DefaultSSHAddr: "root@127.0.0.1:2222",
	}
	if err := SaveConfig(want); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}
	got, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if got != want {
		t.Errorf("读回来的配置 = %+v, want %+v", got, want)
	}
}

// 没有配置文件时给零值,不报错 —— 全新安装就是这个状态,
// 报错会让整个 Service 起不来
func TestLoadConfigMissingFile(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("USERPROFILE", os.Getenv("HOME"))

	got, err := LoadConfig()
	if err != nil {
		t.Fatalf("配置文件不存在不该报错: %v", err)
	}
	if got != (Config{}) {
		t.Errorf("应为零值, got %+v", got)
	}
}

// New() 要把落盘的路径捞回内存,否则 runCLI 解析出来还是 PATH 兜底
func TestNewRestoresBinPath(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("USERPROFILE", os.Getenv("HOME"))

	bin := filepath.Join("D:", "bin", "go-forensic.exe")
	if err := SaveConfig(Config{BinPath: bin, Enabled: true}); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	s := New()
	if got := s.resolveBinary(); got != bin {
		t.Errorf("resolveBinary = %q, want %q —— 启动时没把落盘的路径读回来", got, bin)
	}
	if !s.Config().Enabled {
		t.Error("Enabled 没恢复")
	}
}

// SetConfig 既要落盘,也要把 binPath 同步进内存 —— 只落盘的话,
// 用户刚配完还得重启才生效
func TestSetConfigSyncsMemory(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("USERPROFILE", os.Getenv("HOME"))

	s := New()
	bin := filepath.Join("E:", "x", "go-forensic")
	// 顺带验证前后空白会被去掉:用户从别处粘路径经常带着空格
	if err := s.SetConfig(Config{BinPath: "  " + bin + "  "}); err != nil {
		t.Fatalf("SetConfig: %v", err)
	}
	if got := s.resolveBinary(); got != bin {
		t.Errorf("内存里的路径 = %q, want %q", got, bin)
	}
	onDisk, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if onDisk.BinPath != bin {
		t.Errorf("落盘的路径 = %q, want %q", onDisk.BinPath, bin)
	}
}
