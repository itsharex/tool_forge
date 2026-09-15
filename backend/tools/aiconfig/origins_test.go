package aiconfig

import (
	"os"
	"path/filepath"
	"testing"
)

// 除了 Claude / Codex,本机还有 Gemini CLI、Cline、Continue、Trae ——
// 它们的 MCP 都是「顶层一个 mcpServers 对象」这一种形状,只是各家多几个自己的字段
func TestScanFindsOtherVendors(t *testing.T) {
	home := fakeHome(t)
	write := func(rel, content string) {
		p := filepath.Join(home, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	// Gemini:多 trust / timeout
	write(".gemini/settings.json", `{"general":{},"mcpServers":{
	  "chrome": {"command":"npx","args":["node","x.js"],"trust":true,"timeout":60000}
	}}`)
	// Cline:多 disabled,而且不在家目录 —— 跟着 VS Code 走
	write("AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
		`{"mcpServers":{"fs":{"command":"npx","args":["-y","fs"],"disabled":true}}}`)
	// Continue:config.json 里没有 mcpServers 也要能过
	write(".continue/config.json", `{"models":[]}`)
	// Trae / Cursor 的 mcp.json
	write(".trae/mcp.json", `{"mcpServers":{"trae-one":{"url":"http://x/mcp"}}}`)
	// 各家的 skills
	write(".continue/skills/lark-doc/SKILL.md", "---\ndescription: 飞书文档\n---\n")
	write(".trae/skills/lark-doc/SKILL.md", "---\ndescription: 飞书文档\n---\n")

	snap, err := Scan(Home{Dir: home})
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Problems) != 0 {
		t.Fatalf("不该有问题: %+v", snap.Problems)
	}

	byName := map[string]MCPEntry{}
	for _, m := range snap.MCP {
		byName[m.Name] = m
	}
	if m := byName["chrome"]; m.Source.Origin != OriginGemini || m.Kind != "stdio" {
		t.Errorf("Gemini 那条不对: %+v", m)
	}
	if m := byName["fs"]; m.Source.Origin != OriginCline || m.Enabled {
		t.Errorf("Cline 那条应该是停用状态: %+v", m)
	}
	if m := byName["trae-one"]; m.Source.Origin != OriginTrae || m.Kind != "http" {
		t.Errorf("Trae 那条不对: %+v", m)
	}

	// 两家 skills 目录一模一样 —— 实测就是这样(同一批 lark-* 被同步了两处)。
	// 都要列,而且来源要分得开
	origins := map[Origin]bool{}
	for _, s := range snap.Skills {
		if s.Name == "lark-doc" {
			origins[s.Source.Origin] = true
		}
	}
	if !origins[OriginContinue] || !origins[OriginTrae] {
		t.Errorf("同名 skill 在两家各有一份,两份都要列出: %v", origins)
	}
}

// 每家一条概况,没装的也在 —— 页面上才能回答"我装了 Cursor 吗"
func TestOriginsIncludeAbsentVendors(t *testing.T) {
	snap, _ := Scan(Home{Dir: fakeHome(t)})
	seen := map[Origin]OriginInfo{}
	for _, o := range snap.Origins {
		seen[o.Origin] = o
	}
	for _, want := range []Origin{OriginToolForge, OriginClaude, OriginCodex, OriginGemini,
		OriginCline, OriginContinue, OriginTrae, OriginCursor} {
		if _, ok := seen[want]; !ok {
			t.Errorf("Origins 里少了 %s", want)
		}
	}
	if !seen[OriginClaude].Present {
		t.Error("fakeHome 里有 .claude,应该标为 Present")
	}
	if seen[OriginCursor].Present {
		t.Error("fakeHome 里没有 .cursor,不该标为 Present")
	}
	// 计数要和列表对得上
	if seen[OriginClaude].MCP != 3 {
		t.Errorf("Claude 的 MCP 计数 = %d, want 3(全局 2 + 项目 1)", seen[OriginClaude].MCP)
	}
	if seen[OriginClaude].Plugins != 2 {
		t.Errorf("Claude 的插件计数 = %d, want 2", seen[OriginClaude].Plugins)
	}
}
