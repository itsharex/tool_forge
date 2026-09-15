package aiconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/BurntSushi/toml"
)

// Home 允许测试换根。空串表示用当前用户的主目录。
type Home struct {
	Dir string
}

func (h Home) resolve() (string, error) {
	if strings.TrimSpace(h.Dir) != "" {
		return h.Dir, nil
	}
	return os.UserHomeDir()
}

// Scan 扫一遍本机所有来源。
//
// 任何一处出错都只记进 Problems 继续往下扫 —— 一个文件坏了不该让整页空白,
// 那会让人以为"什么都没配"。
func Scan(h Home) (*Snapshot, error) {
	home, err := h.resolve()
	if err != nil {
		return nil, err
	}
	snap := &Snapshot{
		MCP:      []MCPEntry{},
		Skills:   []SkillEntry{},
		Plugins:  []PluginEntry{},
		Problems: []Problem{},
		Roots:    []string{},
	}

	claudeDir := filepath.Join(home, ".claude")
	codexDir := filepath.Join(home, ".codex")
	claudeJSON := filepath.Join(home, ".claude.json")

	for _, p := range []string{claudeJSON, claudeDir, codexDir, filepath.Join(home, ".toolforge")} {
		if _, err := os.Stat(p); err == nil {
			snap.Roots = append(snap.Roots, p)
		}
	}

	scanClaudeJSON(snap, claudeJSON)
	scanCodexTOML(snap, filepath.Join(codexDir, "config.toml"))
	scanToolForgeMCP(snap, filepath.Join(home, ".toolforge", "mcp", "servers.json"))

	scanSkillDir(snap, filepath.Join(claudeDir, "skills"), Source{
		File: filepath.Join(claudeDir, "skills"), Origin: OriginClaude, Scope: "全局",
	})
	scanSkillDir(snap, filepath.Join(codexDir, "skills"), Source{
		File: filepath.Join(codexDir, "skills"), Origin: OriginCodex, Scope: "全局",
	})

	scanPlugins(snap, claudeDir)

	sortSnapshot(snap)
	return snap, nil
}

// ---- MCP ----

// claudeJSONShape 只挑我们要的字段。整个文件有四十多个键(统计、缓存、A/B 开关……),
// 全反序列化没必要,也免得哪天他们加个奇怪类型把解析搞崩
type claudeJSONShape struct {
	MCPServers map[string]claudeMCPServer `json:"mcpServers"`
	Projects   map[string]struct {
		MCPServers map[string]claudeMCPServer `json:"mcpServers"`
	} `json:"projects"`
}

type claudeMCPServer struct {
	Type    string            `json:"type"`
	Command string            `json:"command"`
	Args    []string          `json:"args"`
	URL     string            `json:"url"`
	Env     map[string]string `json:"env"`
}

func scanClaudeJSON(snap *Snapshot, path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			snap.note(path, err.Error())
		}
		return
	}
	var parsed claudeJSONShape
	if err := json.Unmarshal(data, &parsed); err != nil {
		snap.note(path, "解析失败: "+err.Error())
		return
	}

	for name, s := range parsed.MCPServers {
		snap.MCP = append(snap.MCP, claudeMCPEntry(name, s, Source{
			File: path, Origin: OriginClaude, Scope: "全局",
		}))
	}
	// 按项目配的那批最容易被忘:在 A 项目下配过的服务器,换到 B 项目就没有了,
	// 而两边的现象都是"我明明配过"
	for proj, p := range parsed.Projects {
		for name, s := range p.MCPServers {
			snap.MCP = append(snap.MCP, claudeMCPEntry(name, s, Source{
				File: path, Origin: OriginClaude, Scope: "项目 " + proj,
			}))
		}
	}
}

func claudeMCPEntry(name string, s claudeMCPServer, src Source) MCPEntry {
	kind := s.Type
	if kind == "" {
		if s.URL != "" {
			kind = "http"
		} else {
			kind = "stdio"
		}
	}
	return MCPEntry{
		Name:    name,
		Kind:    kind,
		Command: s.Command,
		Args:    s.Args,
		URL:     s.URL,
		EnvKeys: sortedKeys(s.Env),
		// Claude 那边没有"停用"这个状态:写在文件里就是启用的
		Enabled:    true,
		Toggleable: false,
		Source:     src,
	}
}

// codexTOMLShape Codex 的 config.toml 里我们只要 [mcp_servers.*]
type codexTOMLShape struct {
	MCPServers map[string]struct {
		Command string            `toml:"command"`
		Args    []string          `toml:"args"`
		URL     string            `toml:"url"`
		Env     map[string]string `toml:"env"`
	} `toml:"mcp_servers"`
}

func scanCodexTOML(snap *Snapshot, path string) {
	if _, err := os.Stat(path); err != nil {
		if !os.IsNotExist(err) {
			snap.note(path, err.Error())
		}
		return
	}
	var parsed codexTOMLShape
	if _, err := toml.DecodeFile(path, &parsed); err != nil {
		snap.note(path, "解析失败: "+err.Error())
		return
	}
	for name, s := range parsed.MCPServers {
		kind := "stdio"
		if s.URL != "" {
			kind = "http"
		}
		snap.MCP = append(snap.MCP, MCPEntry{
			Name:       name,
			Kind:       kind,
			Command:    s.Command,
			Args:       s.Args,
			URL:        s.URL,
			EnvKeys:    sortedKeys(s.Env),
			Enabled:    true,
			Toggleable: false,
			Source:     Source{File: path, Origin: OriginCodex, Scope: "全局"},
		})
	}
}

// toolForgeServer 我们自己那份 servers.json 的形状。
// 这里重新声明而不是 import backend/tools/mcp:那个包会把 HTTP 客户端、
// 子进程管理一起拖进来,而这里只想读一个文件
type toolForgeServer struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Kind    string            `json:"kind"`
	Enabled bool              `json:"enabled"`
	Command string            `json:"command"`
	Args    []string          `json:"args"`
	Env     map[string]string `json:"env"`
	URL     string            `json:"url"`
}

func scanToolForgeMCP(snap *Snapshot, path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			snap.note(path, err.Error())
		}
		return
	}
	var list []toolForgeServer
	if err := json.Unmarshal(data, &list); err != nil {
		snap.note(path, "解析失败: "+err.Error())
		return
	}
	for _, s := range list {
		snap.MCP = append(snap.MCP, MCPEntry{
			Name:    s.Name,
			Kind:    s.Kind,
			Command: s.Command,
			Args:    s.Args,
			URL:     s.URL,
			EnvKeys: sortedKeys(s.Env),
			Enabled: s.Enabled,
			// 只有自家的给启停:别家的"停用"语义各不相同(有的删条目、有的另有开关),
			// 我们替它猜一个只会把用户的配置改坏
			Toggleable: true,
			ID:         s.ID,
			Source:     Source{File: path, Origin: OriginToolForge, Scope: "全局"},
		})
	}
}

// ---- skills ----

func scanSkillDir(snap *Snapshot, dir string, src Source) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if !os.IsNotExist(err) {
			snap.note(dir, err.Error())
		}
		return
	}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		skillDir := filepath.Join(dir, e.Name())
		item := SkillEntry{
			Name:   e.Name(),
			Dir:    skillDir,
			Source: src,
		}
		mdPath := filepath.Join(skillDir, "SKILL.md")
		if b, err := os.ReadFile(mdPath); err == nil {
			item.HasSkillMD = true
			item.Description = frontmatterDescription(string(b))
		}
		item.FileCount = countFiles(skillDir)
		if info, err := e.Info(); err == nil {
			item.UpdatedAt = info.ModTime().Format("2006-01-02 15:04")
		}
		snap.Skills = append(snap.Skills, item)
	}
}

// frontmatterDescription 从 SKILL.md 的 YAML 头里取 description。
// 只认最简单的一行式 —— 真出现折行的写法就留空,不猜
func frontmatterDescription(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	if !strings.HasPrefix(s, "---\n") {
		return ""
	}
	end := strings.Index(s[4:], "\n---")
	if end < 0 {
		return ""
	}
	for _, line := range strings.Split(s[4:4+end], "\n") {
		if rest, ok := strings.CutPrefix(strings.TrimSpace(line), "description:"); ok {
			return strings.Trim(strings.TrimSpace(rest), `"'`)
		}
	}
	return ""
}

func countFiles(dir string) int {
	n := 0
	_ = filepath.WalkDir(dir, func(_ string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			n++
		}
		return nil
	})
	return n
}

// ---- 插件 ----

type installedPlugins struct {
	Plugins map[string][]struct {
		Scope       string `json:"scope"`
		InstallPath string `json:"installPath"`
		Version     string `json:"version"`
	} `json:"plugins"`
}

type claudeSettingsShape struct {
	EnabledPlugins map[string]bool `json:"enabledPlugins"`
}

func scanPlugins(snap *Snapshot, claudeDir string) {
	installedPath := filepath.Join(claudeDir, "plugins", "installed_plugins.json")
	settingsPath := filepath.Join(claudeDir, "settings.json")

	installed := map[string]struct {
		path, version string
	}{}
	if data, err := os.ReadFile(installedPath); err == nil {
		var parsed installedPlugins
		if err := json.Unmarshal(data, &parsed); err != nil {
			snap.note(installedPath, "解析失败: "+err.Error())
		} else {
			for name, versions := range parsed.Plugins {
				if len(versions) == 0 {
					continue
				}
				v := versions[len(versions)-1]
				installed[name] = struct{ path, version string }{v.InstallPath, v.Version}
			}
		}
	} else if !os.IsNotExist(err) {
		snap.note(installedPath, err.Error())
	}

	enabled := map[string]bool{}
	if data, err := os.ReadFile(settingsPath); err == nil {
		var parsed claudeSettingsShape
		if err := json.Unmarshal(data, &parsed); err != nil {
			snap.note(settingsPath, "解析失败: "+err.Error())
		} else {
			enabled = parsed.EnabledPlugins
		}
	} else if !os.IsNotExist(err) {
		snap.note(settingsPath, err.Error())
	}

	// 两个文件的并集。只取交集的话,"启用了但没装"这种状态就看不见了 ——
	// 而那恰恰是要让人发现的:它的表现是插件静默不起作用
	names := map[string]bool{}
	for n := range installed {
		names[n] = true
	}
	for n := range enabled {
		names[n] = true
	}

	for name := range names {
		inst, ok := installed[name]
		entry := PluginEntry{
			Name:        name,
			Version:     inst.version,
			InstallPath: inst.path,
			Installed:   ok,
			Enabled:     enabled[name],
			Source:      Source{File: installedPath, Origin: OriginClaude, Scope: "全局"},
		}
		if !ok {
			// 没装的那条,出处只能是 settings.json —— 指向 installed_plugins.json
			// 等于让人去一个根本没有它的文件里找
			entry.Source.File = settingsPath
		}
		if inst.path != "" {
			entry.SkillCount = scanPluginSkills(snap, name, inst.path)
		}
		snap.Plugins = append(snap.Plugins, entry)
	}
}

// scanPluginSkills 插件自带的 skill 也算进 skills 列表,并标明来自哪个插件。
// 不列的话,用户在 ~/.claude/skills 里翻不到它,却在对话里看得见,只会更困惑
func scanPluginSkills(snap *Snapshot, plugin, installPath string) int {
	dir := filepath.Join(installPath, "skills")
	before := len(snap.Skills)
	scanSkillDir(snap, dir, Source{
		File: dir, Origin: OriginClaude, Scope: "插件 " + plugin,
	})
	return len(snap.Skills) - before
}

// ---- 小工具 ----

func (s *Snapshot) note(file, detail string) {
	s.Problems = append(s.Problems, Problem{File: file, Detail: detail})
}

func sortedKeys(m map[string]string) []string {
	if len(m) == 0 {
		return nil
	}
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// sortSnapshot 排序固定下来:map 遍历每次顺序都不同,
// 刷新一下列表就重排会让人以为内容变了
func sortSnapshot(s *Snapshot) {
	sort.Slice(s.MCP, func(i, j int) bool {
		a, b := s.MCP[i], s.MCP[j]
		if a.Source.Origin != b.Source.Origin {
			return a.Source.Origin < b.Source.Origin
		}
		if a.Source.Scope != b.Source.Scope {
			return a.Source.Scope < b.Source.Scope
		}
		return a.Name < b.Name
	})
	sort.Slice(s.Skills, func(i, j int) bool {
		a, b := s.Skills[i], s.Skills[j]
		if a.Source.Origin != b.Source.Origin {
			return a.Source.Origin < b.Source.Origin
		}
		if a.Source.Scope != b.Source.Scope {
			return a.Source.Scope < b.Source.Scope
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	sort.Slice(s.Plugins, func(i, j int) bool { return s.Plugins[i].Name < s.Plugins[j].Name })
	sort.Slice(s.Problems, func(i, j int) bool { return s.Problems[i].File < s.Problems[j].File })
}
