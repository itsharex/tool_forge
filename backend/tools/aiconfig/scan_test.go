package aiconfig

import (
	"os"
	"path/filepath"
	"testing"
)

// 造一份假的本机布局:四处 MCP、三处 skills、插件的装/启用分记两个文件。
// 形状照着 2026-09-15 实测的真实文件写的
func fakeHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()

	write := func(rel, content string) {
		p := filepath.Join(home, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	// Claude 全局 + 按项目各一份
	write(".claude.json", `{
	  "numStartups": 42,
	  "mcpServers": {
	    "acemcp": {"command": "ace", "args": ["--stdio"], "env": {"ACE_TOKEN": "secret-do-not-show"}},
	    "jshook": {"type": "http", "url": "http://127.0.0.1:9000/mcp"}
	  },
	  "projects": {
	    "C:\\proj\\alpha": {"mcpServers": {"context7": {"command": "c7"}}}
	  }
	}`)

	// Codex
	write(".codex/config.toml", "[memories]\ngenerate_memories = true\n\n"+
		"[mcp_servers.node_repl]\ncommand = 'node_repl.exe'\nargs = []\n\n"+
		"[mcp_servers.node_repl.env]\nCODEX_HOME = 'x'\n")

	// 我们自己的
	write(".toolforge/mcp/servers.json", `[
	  {"id":"s1","name":"exa","kind":"http","enabled":true,"url":"https://x/mcp"},
	  {"id":"s2","name":"停用的","kind":"stdio","enabled":false,"command":"foo"}
	]`)

	// skills:三处
	write(".claude/skills/git-commit-helper/SKILL.md", "---\nname: git-commit-helper\ndescription: 提交助手\n---\n正文\n")
	write(".claude/skills/git-commit-helper/extra.md", "x")
	write(".codex/skills/hatch-pet/SKILL.md", "---\ndescription: 养宠物\n---\n")
	write(".claude/plugins/cache/openai-codex/codex/1.0.6/skills/codex-rescue/SKILL.md",
		"---\ndescription: 救援\n---\n")

	// 插件:装了一个,启用了两个 —— 实测就是这个对不上的状态
	write(".claude/plugins/installed_plugins.json", `{"version":2,"plugins":{
	  "codex@openai-codex":[{"scope":"user","installPath":"`+
		filepath.ToSlash(filepath.Join(home, ".claude/plugins/cache/openai-codex/codex/1.0.6"))+
		`","version":"1.0.6"}]}}`)
	write(".claude/settings.json", `{"enabledPlugins":{
	  "codex@openai-codex": true,
	  "api-development-kit@claude-code-workflows": true
	}}`)

	return home
}

func TestScanFindsAllMCPSources(t *testing.T) {
	snap, err := Scan(Home{Dir: fakeHome(t)})
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Problems) != 0 {
		t.Fatalf("不该有问题: %+v", snap.Problems)
	}

	// 四处来源一个都不能漏 —— 漏一处的表现是"我明明配过却看不见"
	want := map[string]string{
		"acemcp":    "全局",
		"jshook":    "全局",
		"context7":  "项目 C:\\proj\\alpha",
		"node_repl": "全局",
		"exa":       "全局",
		"停用的":       "全局",
	}
	got := map[string]string{}
	for _, m := range snap.MCP {
		got[m.Name] = m.Source.Scope
	}
	for name, scope := range want {
		if got[name] != scope {
			t.Errorf("MCP %q 的 scope = %q, want %q（全部: %+v）", name, got[name], scope, got)
		}
	}
	if len(snap.MCP) != len(want) {
		t.Errorf("MCP 条数 = %d, want %d", len(snap.MCP), len(want))
	}
}

// 每一条都要带上出自哪个文件 —— 这个页面的全部价值就在这儿。
// 少了它就只是把四个地方的东西混成一锅,比分开看还难查
func TestEveryEntryCarriesSourceFile(t *testing.T) {
	snap, _ := Scan(Home{Dir: fakeHome(t)})
	for _, m := range snap.MCP {
		if m.Source.File == "" {
			t.Errorf("MCP %q 没有来源文件", m.Name)
		}
	}
	for _, s := range snap.Skills {
		if s.Source.File == "" {
			t.Errorf("skill %q 没有来源文件", s.Name)
		}
	}
	for _, p := range snap.Plugins {
		if p.Source.File == "" {
			t.Errorf("插件 %q 没有来源文件", p.Name)
		}
	}
}

// 环境变量里常年躺着 API key,汇总页只列键名
func TestEnvValuesNeverLeak(t *testing.T) {
	snap, _ := Scan(Home{Dir: fakeHome(t)})
	for _, m := range snap.MCP {
		for _, k := range m.EnvKeys {
			if k == "secret-do-not-show" {
				t.Fatal("环境变量的值被带出来了")
			}
		}
		if m.Name == "acemcp" {
			if len(m.EnvKeys) != 1 || m.EnvKeys[0] != "ACE_TOKEN" {
				t.Errorf("acemcp 的 EnvKeys = %v, want [ACE_TOKEN]", m.EnvKeys)
			}
		}
	}
}

// 只有自家的能启停:别家的"停用"语义各不相同,替它猜一个只会把配置改坏
func TestOnlyOwnServersAreToggleable(t *testing.T) {
	snap, _ := Scan(Home{Dir: fakeHome(t)})
	for _, m := range snap.MCP {
		own := m.Source.Origin == OriginToolForge
		if m.Toggleable != own {
			t.Errorf("%q(%s) Toggleable = %v, want %v", m.Name, m.Source.Origin, m.Toggleable, own)
		}
		if own && m.ID == "" {
			t.Errorf("%q 能启停却没有 ID,点下去没法定位", m.Name)
		}
	}
}

// 插件自带的 skill 也要列出来并标明来自哪个插件 ——
// 用户在 ~/.claude/skills 里翻不到它,却在对话里看得见
func TestSkillsFromAllThreePlaces(t *testing.T) {
	snap, _ := Scan(Home{Dir: fakeHome(t)})
	byName := map[string]SkillEntry{}
	for _, s := range snap.Skills {
		byName[s.Name] = s
	}
	if len(snap.Skills) != 3 {
		t.Fatalf("skills 条数 = %d, want 3: %+v", len(snap.Skills), byName)
	}
	if s := byName["git-commit-helper"]; s.Description != "提交助手" || s.FileCount != 2 {
		t.Errorf("claude skill 解析不对: %+v", s)
	}
	if s := byName["hatch-pet"]; s.Source.Origin != OriginCodex {
		t.Errorf("codex skill 的来源不对: %+v", s)
	}
	if s := byName["codex-rescue"]; s.Source.Scope != "插件 codex@openai-codex" {
		t.Errorf("插件自带的 skill 要标明出自哪个插件, got %q", s.Source.Scope)
	}
}

// 「装了」和「启用了」记在两个文件里,实测会对不上。
// 只取交集的话,"启用了但没装"就看不见了 —— 而它的表现正是插件静默不起作用
func TestPluginInstalledAndEnabledAreSeparate(t *testing.T) {
	snap, _ := Scan(Home{Dir: fakeHome(t)})
	byName := map[string]PluginEntry{}
	for _, p := range snap.Plugins {
		byName[p.Name] = p
	}
	if len(snap.Plugins) != 2 {
		t.Fatalf("插件条数 = %d, want 2: %+v", len(snap.Plugins), byName)
	}
	if p := byName["codex@openai-codex"]; !p.Installed || !p.Enabled || p.Version != "1.0.6" {
		t.Errorf("装了且启用的那条不对: %+v", p)
	}
	ghost := byName["api-development-kit@claude-code-workflows"]
	if ghost.Installed {
		t.Error("这条并没有装")
	}
	if !ghost.Enabled {
		t.Error("这条是启用状态")
	}
	// 没装的那条,出处要指向 settings.json;指向 installed_plugins.json
	// 等于让人去一个根本没有它的文件里找
	if filepath.Base(ghost.Source.File) != "settings.json" {
		t.Errorf("没装的插件出处应指向 settings.json, got %q", ghost.Source.File)
	}
}

// 一个文件坏了不能让整页空白 —— 那会让人以为"什么都没配"
func TestBrokenFileBecomesProblemNotSilence(t *testing.T) {
	home := fakeHome(t)
	if err := os.WriteFile(filepath.Join(home, ".claude.json"), []byte("{ 这不是 JSON"), 0o644); err != nil {
		t.Fatal(err)
	}
	snap, err := Scan(Home{Dir: home})
	if err != nil {
		t.Fatalf("单个文件坏了不该让整次扫描失败: %v", err)
	}
	if len(snap.Problems) == 0 {
		t.Fatal("解析失败必须报出来,不能默默跳过")
	}
	// 别的来源照扫不误
	if len(snap.MCP) == 0 {
		t.Error("一个来源坏了,其余来源还应该正常列出")
	}
}

// 全新机器上什么都没有:不该报错,也不该返回 nil 切片(前端拿到 null 会崩)
func TestEmptyHomeIsNotAnError(t *testing.T) {
	snap, err := Scan(Home{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if snap.MCP == nil || snap.Skills == nil || snap.Plugins == nil || snap.Problems == nil {
		t.Error("空结果要给空切片而不是 nil —— Go 的 nil 切片到了前端是 null")
	}
	if len(snap.Problems) != 0 {
		t.Errorf("文件不存在是正常状态,不该记成问题: %+v", snap.Problems)
	}
}

func TestFrontmatterDescription(t *testing.T) {
	cases := map[string]string{
		"---\nname: a\ndescription: 一句话\n---\n正文": "一句话",
		"---\ndescription: \"带引号\"\n---\n":        "带引号",
		"---\r\ndescription: CRLF 也要认\r\n---\r\n": "CRLF 也要认",
		"没有 frontmatter":                          "",
		"---\nname: 只有名字\n---\n":                  "",
	}
	for in, want := range cases {
		if got := frontmatterDescription(in); got != want {
			t.Errorf("frontmatterDescription(%q) = %q, want %q", in, got, want)
		}
	}
}
