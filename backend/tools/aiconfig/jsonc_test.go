package aiconfig

import (
	"path/filepath"
	"testing"
)

// 名单外工具的 settings.json 什么样都有:实测 .factory 的是带注释的 JSONC。
// 它和 MCP 无关,不该被读、更不该报成「文件没读成」—— 那会让人以为扫描结果不全
func TestDiscoveredVendorIgnoresUnrelatedJSONC(t *testing.T) {
	home := fakeHome(t)
	writeUnder(t, home, ".factory/skills/x/SKILL.md", "---\ndescription: x\n---\n")
	writeUnder(t, home, ".factory/settings.json", "// Factory CLI Settings\n{\n  \"model\": \"m\"\n}\n")
	writeUnder(t, home, ".factory/config.toml", "[cli]\ninstaller = 'npm'\n")

	snap, err := Scan(Home{Dir: home})
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range snap.Problems {
		if filepath.Base(filepath.Dir(p.File)) == ".factory" {
			t.Errorf("和 MCP 无关的文件不该报问题: %s: %s", p.File, p.Detail)
		}
	}
	found := false
	for _, o := range snap.Origins {
		if o.Origin == "factory" && o.Skills == 1 {
			found = true
		}
	}
	if !found {
		t.Error("factory 该被发现且 skills 计为 1")
	}
}
