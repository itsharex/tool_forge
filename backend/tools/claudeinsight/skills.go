package claudeinsight

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// ---- 类型 ----

// SkillSummary skill 列表页的一行
type SkillSummary struct {
	Name        string `json:"name"`         // 子目录名
	Description string `json:"description"`  // 从 SKILL.md 首段或 frontmatter 抽
	FileCount   int    `json:"file_count"`
	HasSkillMD  bool   `json:"has_skill_md"`
	UpdatedAt   string `json:"updated_at"`   // RFC3339
}

// SkillList 列表页的返回值
type SkillList struct {
	Items    []SkillSummary `json:"items"`
	SkillDir string         `json:"skill_dir"`
}

// SkillFile skill 内部的单个文件/目录节点
type SkillFile struct {
	Path      string `json:"path"`       // 相对 skill 根
	IsDir     bool   `json:"is_dir"`
	Size      int64  `json:"size"`
	UpdatedAt string `json:"updated_at"` // RFC3339
}

// SkillFileList skill 内部文件列表
type SkillFileList struct {
	Skill string      `json:"skill"`
	Files []SkillFile `json:"files"`
}

// SkillFileContent 单文件内容
type SkillFileContent struct {
	Skill     string `json:"skill"`
	Path      string `json:"path"`
	Content   string `json:"content"`
	Size      int64  `json:"size"`
	UpdatedAt string `json:"updated_at"`
}

// ---- 路径安全 ----

// skillNamePattern 限定 skill 名:字母数字、下划线、连字符、点;不允许空格、斜杠、父级符号。
var skillNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

func resolveSkillsDir(claudeDir string) (string, error) {
	if strings.TrimSpace(claudeDir) == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		claudeDir = filepath.Join(home, ".claude")
	}
	return filepath.Join(claudeDir, "skills"), nil
}

// ensureUnder 确保 target 的绝对路径必须在 base 下,防路径穿越。
func ensureUnder(base, target string) error {
	baseAbs, err := filepath.Abs(base)
	if err != nil {
		return err
	}
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	baseAbs = filepath.Clean(baseAbs) + string(filepath.Separator)
	targetAbs = filepath.Clean(targetAbs)
	if targetAbs == strings.TrimSuffix(baseAbs, string(filepath.Separator)) {
		return nil // target 就是 base 本身
	}
	if !strings.HasPrefix(targetAbs+string(filepath.Separator), baseAbs) {
		return fmt.Errorf("路径越界: %s 不在 %s 下", targetAbs, base)
	}
	return nil
}

func validateSkillName(name string) error {
	if !skillNamePattern.MatchString(name) {
		return fmt.Errorf("skill 名称只能包含字母、数字、下划线、连字符和点,且首字符为字母数字")
	}
	return nil
}

// validateRelPath 校验 skill 内部相对路径:不能穿越到父级,不能是绝对路径。
func validateRelPath(rel string) error {
	if rel == "" {
		return fmt.Errorf("文件路径不能为空")
	}
	if filepath.IsAbs(rel) {
		return fmt.Errorf("不允许绝对路径")
	}
	clean := filepath.Clean(rel)
	if strings.HasPrefix(clean, "..") || strings.Contains(clean, string(filepath.Separator)+"..") {
		return fmt.Errorf("不允许父级引用")
	}
	return nil
}

// skillAbsPath 拼出 skill 下某文件的绝对路径并二次校验。
func skillAbsPath(claudeDir, skill, rel string) (string, string, error) {
	if err := validateSkillName(skill); err != nil {
		return "", "", err
	}
	if err := validateRelPath(rel); err != nil {
		return "", "", err
	}
	skillsDir, err := resolveSkillsDir(claudeDir)
	if err != nil {
		return "", "", err
	}
	skillRoot := filepath.Join(skillsDir, skill)
	target := filepath.Join(skillRoot, filepath.Clean(rel))
	if err := ensureUnder(skillRoot, target); err != nil {
		return "", "", err
	}
	return skillRoot, target, nil
}

// ---- 公共 API ----

// ListSkills 列出 ~/.claude/skills 下所有 skill 子目录。
func ListSkills(claudeDir string) (*SkillList, error) {
	skillsDir, err := resolveSkillsDir(claudeDir)
	if err != nil {
		return nil, err
	}
	out := &SkillList{SkillDir: skillsDir, Items: []SkillSummary{}}
	entries, err := os.ReadDir(skillsDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return out, nil
		}
		return nil, err
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		if err := validateSkillName(name); err != nil {
			// 跳过不合规的目录(比如 .DS_Store 或 . 开头的)
			continue
		}
		summary := summarizeSkill(skillsDir, name)
		out.Items = append(out.Items, summary)
	}
	sort.Slice(out.Items, func(i, j int) bool {
		return strings.ToLower(out.Items[i].Name) < strings.ToLower(out.Items[j].Name)
	})
	return out, nil
}

func summarizeSkill(skillsDir, name string) SkillSummary {
	root := filepath.Join(skillsDir, name)
	s := SkillSummary{Name: name}
	var files int
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		files++
		return nil
	})
	s.FileCount = files

	skillMD := filepath.Join(root, "SKILL.md")
	if info, err := os.Stat(skillMD); err == nil && !info.IsDir() {
		s.HasSkillMD = true
		s.UpdatedAt = info.ModTime().UTC().Format(time.RFC3339)
		if content, err := os.ReadFile(skillMD); err == nil {
			s.Description = extractSkillDescription(string(content))
		}
	} else if info, err := os.Stat(root); err == nil {
		s.UpdatedAt = info.ModTime().UTC().Format(time.RFC3339)
	}
	return s
}

// extractSkillDescription 从 SKILL.md 内容里抽一个简短描述。
// 优先:frontmatter 里的 `description:` 字段;否则取第一段非空、非 frontmatter、非标题的正文。
func extractSkillDescription(content string) string {
	lines := strings.Split(content, "\n")
	// frontmatter: 以 --- 开头结尾
	inFM := false
	bodyStart := 0
	if len(lines) > 0 && strings.TrimSpace(lines[0]) == "---" {
		inFM = true
		for i := 1; i < len(lines); i++ {
			if strings.TrimSpace(lines[i]) == "---" {
				bodyStart = i + 1
				inFM = false
				break
			}
			// 尝试抽 description
			trim := strings.TrimSpace(lines[i])
			if strings.HasPrefix(strings.ToLower(trim), "description:") {
				desc := strings.TrimSpace(trim[len("description:"):])
				desc = strings.Trim(desc, "\"'")
				if desc != "" {
					return truncateLine(desc, 160)
				}
			}
		}
	}
	if inFM {
		return "" // frontmatter 未闭合,放弃
	}
	for i := bodyStart; i < len(lines); i++ {
		l := strings.TrimSpace(lines[i])
		if l == "" || strings.HasPrefix(l, "#") {
			continue
		}
		return truncateLine(l, 160)
	}
	return ""
}

func truncateLine(s string, n int) string {
	runes := []rune(s)
	if len(runes) > n {
		return string(runes[:n]) + "…"
	}
	return s
}

// ListSkillFiles 列出某个 skill 子目录下的所有文件(递归展平)。
func ListSkillFiles(claudeDir, skill string) (*SkillFileList, error) {
	if err := validateSkillName(skill); err != nil {
		return nil, err
	}
	skillsDir, err := resolveSkillsDir(claudeDir)
	if err != nil {
		return nil, err
	}
	root := filepath.Join(skillsDir, skill)
	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s 不是一个目录", root)
	}

	out := &SkillFileList{Skill: skill, Files: []SkillFile{}}
	err = filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if path == root {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		var size int64
		var mod time.Time
		if fi, err := d.Info(); err == nil {
			size = fi.Size()
			mod = fi.ModTime()
		}
		out.Files = append(out.Files, SkillFile{
			Path:      filepath.ToSlash(rel),
			IsDir:     d.IsDir(),
			Size:      size,
			UpdatedAt: mod.UTC().Format(time.RFC3339),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(out.Files, func(i, j int) bool {
		// 目录排前面,再按字典序
		if out.Files[i].IsDir != out.Files[j].IsDir {
			return out.Files[i].IsDir
		}
		return strings.ToLower(out.Files[i].Path) < strings.ToLower(out.Files[j].Path)
	})
	return out, nil
}

// ReadSkillFile 读取 skill 下某文件的内容。
func ReadSkillFile(claudeDir, skill, rel string) (*SkillFileContent, error) {
	_, target, err := skillAbsPath(claudeDir, skill, rel)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(target)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, fmt.Errorf("%s 是目录,不能作为文件读取", rel)
	}
	// 大文件保护:超过 4MB 拒绝读,避免 JSON 序列化撑爆 wails
	const maxRead = 4 * 1024 * 1024
	if info.Size() > maxRead {
		return nil, fmt.Errorf("文件过大(%d bytes),超过 4 MB 限制", info.Size())
	}
	data, err := os.ReadFile(target)
	if err != nil {
		return nil, err
	}
	return &SkillFileContent{
		Skill:     skill,
		Path:      filepath.ToSlash(rel),
		Content:   string(data),
		Size:      info.Size(),
		UpdatedAt: info.ModTime().UTC().Format(time.RFC3339),
	}, nil
}

// WriteSkillFile 覆盖或创建一个 skill 下的文件。
// 会按需创建中间目录;文件大小上限 4 MB。
func WriteSkillFile(claudeDir, skill, rel, content string) error {
	skillRoot, target, err := skillAbsPath(claudeDir, skill, rel)
	if err != nil {
		return err
	}
	const maxWrite = 4 * 1024 * 1024
	if len(content) > maxWrite {
		return fmt.Errorf("内容过大(%d bytes),超过 4 MB 限制", len(content))
	}
	// 保证 skill 根目录存在
	if err := os.MkdirAll(skillRoot, 0o755); err != nil {
		return err
	}
	// 保证目标文件的中间目录存在
	if dir := filepath.Dir(target); dir != "" && dir != skillRoot {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return os.WriteFile(target, []byte(content), 0o644)
}

// CreateSkill 新建一个 skill 目录,并写入默认 SKILL.md 模板。
// 若同名已存在则报错。
func CreateSkill(claudeDir, name string) error {
	if err := validateSkillName(name); err != nil {
		return err
	}
	skillsDir, err := resolveSkillsDir(claudeDir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(skillsDir, 0o755); err != nil {
		return err
	}
	root := filepath.Join(skillsDir, name)
	if _, err := os.Stat(root); err == nil {
		return fmt.Errorf("skill %q 已存在", name)
	}
	if err := os.Mkdir(root, 0o755); err != nil {
		return err
	}
	tpl := fmt.Sprintf(`---
name: %s
description: 简要描述这个 skill 的用途与触发场景
---

# %s

在这里写清楚 skill 的使用说明、触发关键词、示例。
`, name, name)
	return os.WriteFile(filepath.Join(root, "SKILL.md"), []byte(tpl), 0o644)
}

// DeleteSkill 删除整个 skill 目录(含内部所有文件)。
func DeleteSkill(claudeDir, name string) error {
	if err := validateSkillName(name); err != nil {
		return err
	}
	skillsDir, err := resolveSkillsDir(claudeDir)
	if err != nil {
		return err
	}
	root := filepath.Join(skillsDir, name)
	if err := ensureUnder(skillsDir, root); err != nil {
		return err
	}
	info, err := os.Stat(root)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("%s 不是一个目录", root)
	}
	return os.RemoveAll(root)
}

// DeleteSkillFile 删除 skill 下的一个文件或空目录。
func DeleteSkillFile(claudeDir, skill, rel string) error {
	_, target, err := skillAbsPath(claudeDir, skill, rel)
	if err != nil {
		return err
	}
	info, err := os.Stat(target)
	if err != nil {
		return err
	}
	if info.IsDir() {
		// 非空目录拒绝,避免用户误删整棵子树;要删整个 skill 走 DeleteSkill
		empty, err := isDirEmpty(target)
		if err != nil {
			return err
		}
		if !empty {
			return fmt.Errorf("目录非空,无法删除: %s", rel)
		}
	}
	return os.Remove(target)
}

func isDirEmpty(path string) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()
	names, err := f.Readdirnames(1)
	if err != nil && err.Error() != "EOF" {
		return false, err
	}
	return len(names) == 0, nil
}
