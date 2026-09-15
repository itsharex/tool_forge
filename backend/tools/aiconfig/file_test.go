package aiconfig

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 路径范围必须拦住 —— 这两个绑定要是能读任意路径,
// 而这个应用同时还是个 MCP server,就等于给 agent 开了扇读写整盘的门
func TestPathMustStayInsideAIConfig(t *testing.T) {
	home := fakeHome(t)
	h := Home{Dir: home}

	ok := []string{
		filepath.Join(home, ".claude.json"),
		filepath.Join(home, ".claude", "settings.json"),
		filepath.Join(home, ".codex", "config.toml"),
		filepath.Join(home, ".toolforge", "mcp", "servers.json"),
	}
	for _, p := range ok {
		if _, err := checkPath(h, p); err != nil {
			t.Errorf("%q 应该允许: %v", p, err)
		}
	}

	// 写一个同前缀但不同的目录,确认前缀匹配没把它放进来
	sneaky := filepath.Join(home, ".claudeXXX", "x.json")
	if err := os.MkdirAll(filepath.Dir(sneaky), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(sneaky, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}

	bad := []string{
		sneaky,
		filepath.Join(home, "别处.json"),
		filepath.Join(home, ".claude", "..", "..", "windows", "system32", "x"),
		"C:\\Windows\\win.ini",
		"/etc/passwd",
	}
	for _, p := range bad {
		if _, err := checkPath(h, p); err == nil {
			t.Errorf("%q 不该被允许", p)
		}
	}
}

// 写之前必须留备份:改的是别家程序的配置,改坏了对方可能起不来
func TestWriteKeepsBackup(t *testing.T) {
	home := fakeHome(t)
	h := Home{Dir: home}
	target := filepath.Join(home, ".claude", "settings.json")

	before, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if err := WriteFile(h, target, `{"enabledPlugins":{}}`); err != nil {
		t.Fatal(err)
	}

	got, _ := os.ReadFile(target)
	if string(got) != `{"enabledPlugins":{}}` {
		t.Errorf("没写进去: %q", got)
	}

	entries, _ := os.ReadDir(filepath.Dir(target))
	var baks []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "settings.json.") && strings.HasSuffix(e.Name(), ".bak") {
			baks = append(baks, e.Name())
		}
	}
	if len(baks) != 1 {
		t.Fatalf("应该留下一份备份, got %v", baks)
	}
	bakContent, _ := os.ReadFile(filepath.Join(filepath.Dir(target), baks[0]))
	if string(bakContent) != string(before) {
		t.Error("备份里存的不是改动前的内容")
	}
}

// 备份带时间戳,不覆盖上一次 —— 连着改错两次时,单一 .bak 里
// 存的已经是第一次改错的结果,恢复了等于没恢复
func TestBackupsDoNotOverwriteEachOther(t *testing.T) {
	home := fakeHome(t)
	h := Home{Dir: home}
	target := filepath.Join(home, ".claude", "settings.json")

	// 时间戳精确到秒,同一秒内写两次会撞名;这里直接查命名形态而不是数数量
	if err := WriteFile(h, target, `{"a":1}`); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(filepath.Dir(target))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".bak") && e.Name() == "settings.json.bak" {
			t.Error("备份名里没有时间戳,第二次改动会把第一次的备份盖掉")
		}
	}
}

// 不在白名单里的扩展名只读 —— 免得从这里改到脚本、可执行文件之类
func TestNonTextExtensionIsReadOnly(t *testing.T) {
	home := fakeHome(t)
	h := Home{Dir: home}
	p := filepath.Join(home, ".claude", "statusline.ps1")
	if err := os.WriteFile(p, []byte("echo hi"), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := ReadFile(h, p)
	if err != nil {
		t.Fatalf("读应该是允许的: %v", err)
	}
	if got.Editable {
		t.Error(".ps1 不该可编辑")
	}
	if got.Reason == "" {
		t.Error("不可编辑要给原因,否则界面上只是个灰按钮")
	}
	if err := WriteFile(h, p, "echo 改了"); err == nil {
		t.Error(".ps1 不该写得进去")
	}
}

// 目录、不存在的文件要给明确错误,不能静默成空内容
func TestReadFileEdgeCases(t *testing.T) {
	home := fakeHome(t)
	h := Home{Dir: home}

	if _, err := ReadFile(h, filepath.Join(home, ".claude")); err == nil {
		t.Error("目录不该当文件读")
	}
	if _, err := ReadFile(h, filepath.Join(home, ".claude", "不存在.json")); err == nil {
		t.Error("文件不存在要报错")
	}
}

// 写回去的内容必须一字不差 —— 这个包刻意不解析再序列化,
// 那样会把别人手写的注释、键顺序、缩进全毁掉
func TestWriteIsByteExact(t *testing.T) {
	home := fakeHome(t)
	h := Home{Dir: home}
	target := filepath.Join(home, ".codex", "config.toml")

	raw := "# 手写的注释要留住\n[mcp_servers.x]\ncommand = 'y'   # 行尾注释\n\n\n# 末尾空行也要留\n"
	if err := WriteFile(h, target, raw); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(target)
	if string(got) != raw {
		t.Errorf("写回的内容变了:\n%q\n≠\n%q", got, raw)
	}

	back, err := ReadFile(h, target)
	if err != nil {
		t.Fatal(err)
	}
	if back.Content != raw {
		t.Errorf("读回来的内容变了: %q", back.Content)
	}
}
