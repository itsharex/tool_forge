package aiconfig

import (
	"os"
	"path/filepath"
	"testing"
)

func writeUnder(t *testing.T, home, rel, content string) {
	t.Helper()
	p := filepath.Join(home, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// 名单之外的工具要按形状自动发现 —— 实测一台机器上名单外就有 .factory / .cc-switch /
// .mirasim 三家,而它们的 skills 在对话里是看得见的。每冒出一家就改代码不是办法
func TestDiscoverUnknownVendorsByShape(t *testing.T) {
	home := fakeHome(t)
	// 三种形状各一家
	writeUnder(t, home, ".factory/mcp.json", `{"mcpServers":{"f1":{"command":"factory-mcp"}}}`)
	writeUnder(t, home, ".mirasim/skills/eval/SKILL.md", "---\ndescription: 评测\n---\n")
	writeUnder(t, home, ".zeta/config.toml", "[mcp_servers.z]\ncommand = 'zeta'\n")
	// 干扰项:有 config.toml 但和 MCP 无关,不能被当成一家
	writeUnder(t, home, ".dbfingerprint/config.toml", "[db]\nhost = 'x'\n")
	// 干扰项:普通隐藏文件
	writeUnder(t, home, ".bashrc", "export X=1\n")

	snap, err := Scan(Home{Dir: home})
	if err != nil {
		t.Fatal(err)
	}
	byOrigin := map[Origin]OriginInfo{}
	for _, o := range snap.Origins {
		byOrigin[o.Origin] = o
	}

	for _, want := range []Origin{"factory", "mirasim", "zeta"} {
		o, ok := byOrigin[want]
		if !ok {
			t.Errorf("没有按形状发现 %s", want)
			continue
		}
		if o.Known {
			t.Errorf("%s 不在名单里,Known 应为 false", want)
		}
		if !o.Present {
			t.Errorf("%s 目录存在,Present 应为 true", want)
		}
	}
	if _, ok := byOrigin["dbfingerprint"]; ok {
		t.Error("只有 config.toml 而没有 MCP 段的目录不该被当成一家")
	}
	if _, ok := byOrigin["bashrc"]; ok {
		t.Error("隐藏文件不该被当成目录")
	}

	// 发现之后内容也要真的扫进去
	if byOrigin["factory"].MCP != 1 {
		t.Errorf("factory 的 MCP 计数 = %d, want 1", byOrigin["factory"].MCP)
	}
	if byOrigin["mirasim"].Skills != 1 {
		t.Errorf("mirasim 的 skills 计数 = %d, want 1", byOrigin["mirasim"].Skills)
	}
	if byOrigin["zeta"].MCP != 1 {
		t.Errorf("zeta 的 MCP 计数 = %d, want 1", byOrigin["zeta"].MCP)
	}
}

// 名单里的仍然标 Known,页面据此决定给不给 logo
func TestKnownVendorsStayKnown(t *testing.T) {
	snap, _ := Scan(Home{Dir: fakeHome(t)})
	for _, o := range snap.Origins {
		switch o.Origin {
		case OriginClaude, OriginCodex, OriginToolForge, OriginShared, OriginGrok:
			if !o.Known {
				t.Errorf("%s 在名单里,Known 应为 true", o.Origin)
			}
		}
	}
}

// Grok:MCP 走 Codex 同款 toml;skills 有两处 —— 用户软链进去的和它自带的,
// 自带的随版本更新、改了会被覆盖,必须分开标
func TestGrokBundledSkillsAreScopedSeparately(t *testing.T) {
	home := fakeHome(t)
	writeUnder(t, home, ".grok/config.toml", "[models]\ndefault = 'grok-4.6'\n\n[mcp_servers.g]\ncommand = 'g'\n")
	writeUnder(t, home, ".grok/skills/lark-doc/SKILL.md", "---\ndescription: 飞书\n---\n")
	writeUnder(t, home, ".grok/bundled/skills/docx/SKILL.md", "---\ndescription: Word\n---\n")

	snap, _ := Scan(Home{Dir: home})
	scopes := map[string]string{}
	for _, s := range snap.Skills {
		if s.Source.Origin == OriginGrok {
			scopes[s.Name] = s.Source.Scope
		}
	}
	if scopes["lark-doc"] != "全局" {
		t.Errorf("用户自己放进去的 skill scope = %q, want 全局", scopes["lark-doc"])
	}
	if scopes["docx"] != "自带" {
		t.Errorf("Grok 自带的 skill scope = %q, want 自带", scopes["docx"])
	}
	found := false
	for _, m := range snap.MCP {
		if m.Source.Origin == OriginGrok && m.Name == "g" {
			found = true
		}
	}
	if !found {
		t.Error("Grok 的 [mcp_servers.g] 没扫到")
	}
}
