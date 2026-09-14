package claudeinsight

// 项目级"记忆笔记":Claude Code 在 ~/.claude/projects/<项目>/memory/ 下维护的一组
// markdown 笔记(含 MEMORY.md 索引,带 [[wikilink]] 互链)。这里把它按项目浏览/读写。
//
// 复用 skills.go 里的 ensureUnder / validateRelPath / isDirEmpty / validateSkillName
// 与 export.go/scanner.go 的 resolveClaudeDir,不重复定义。

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// MemoryProject 一个含 memory/ 笔记的项目
type MemoryProject struct {
	Project   string `json:"project"` // projects 下的目录名(编码后的 cwd)
	FileCount int    `json:"file_count"`
	HasIndex  bool   `json:"has_index"` // 是否有 MEMORY.md
	UpdatedAt string `json:"updated_at"`
}

// MemoryProjectList 项目列表
type MemoryProjectList struct {
	Items       []MemoryProject `json:"items"`
	ProjectsDir string          `json:"projects_dir"`
}

// MemoryNote memory 目录下的一个文件/目录节点
type MemoryNote struct {
	Path      string `json:"path"` // 相对 memory 根
	IsDir     bool   `json:"is_dir"`
	Size      int64  `json:"size"`
	UpdatedAt string `json:"updated_at"`
}

// MemoryNoteList 某项目的笔记文件列表
type MemoryNoteList struct {
	Project string       `json:"project"`
	Files   []MemoryNote `json:"files"`
}

// MemoryNoteContent 单条笔记内容
type MemoryNoteContent struct {
	Project   string `json:"project"`
	Path      string `json:"path"`
	Content   string `json:"content"`
	Size      int64  `json:"size"`
	UpdatedAt string `json:"updated_at"`
}

func resolveProjectsDir(claudeDir string) (string, error) {
	dir, err := resolveClaudeDir(claudeDir)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "projects"), nil
}

// memoryRoot 返回 (projectsDir, memoryRoot),并做项目名与越界校验。
func memoryRoot(claudeDir, project string) (string, string, error) {
	if err := validateSkillName(project); err != nil {
		return "", "", fmt.Errorf("非法项目名")
	}
	projectsDir, err := resolveProjectsDir(claudeDir)
	if err != nil {
		return "", "", err
	}
	root := filepath.Join(projectsDir, project, "memory")
	if err := ensureUnder(projectsDir, root); err != nil {
		return "", "", err
	}
	return projectsDir, root, nil
}

// ListMemoryProjects 列出所有含非空 memory/ 的项目(按最近更新倒序)。
func ListMemoryProjects(claudeDir string) (*MemoryProjectList, error) {
	projectsDir, err := resolveProjectsDir(claudeDir)
	if err != nil {
		return nil, err
	}
	out := &MemoryProjectList{ProjectsDir: projectsDir, Items: []MemoryProject{}}
	entries, err := os.ReadDir(projectsDir)
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
		memDir := filepath.Join(projectsDir, e.Name(), "memory")
		mi, err := os.Stat(memDir)
		if err != nil || !mi.IsDir() {
			continue
		}
		var count int
		var hasIndex bool
		var latest time.Time
		_ = filepath.WalkDir(memDir, func(p string, d os.DirEntry, werr error) error {
			if werr != nil || d.IsDir() {
				return nil
			}
			count++
			if strings.EqualFold(d.Name(), "MEMORY.md") {
				hasIndex = true
			}
			if fi, e := d.Info(); e == nil && fi.ModTime().After(latest) {
				latest = fi.ModTime()
			}
			return nil
		})
		if count == 0 {
			continue
		}
		if latest.IsZero() {
			latest = mi.ModTime()
		}
		out.Items = append(out.Items, MemoryProject{
			Project:   e.Name(),
			FileCount: count,
			HasIndex:  hasIndex,
			UpdatedAt: latest.UTC().Format(time.RFC3339),
		})
	}
	sort.Slice(out.Items, func(i, j int) bool {
		return out.Items[i].UpdatedAt > out.Items[j].UpdatedAt
	})
	return out, nil
}

// ListMemoryNotes 列出某项目 memory 下所有文件(MEMORY.md 置顶)。
func ListMemoryNotes(claudeDir, project string) (*MemoryNoteList, error) {
	_, root, err := memoryRoot(claudeDir, project)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("memory 不是目录")
	}
	out := &MemoryNoteList{Project: project, Files: []MemoryNote{}}
	err = filepath.WalkDir(root, func(p string, d os.DirEntry, werr error) error {
		if werr != nil || p == root {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		var size int64
		var mod time.Time
		if fi, e := d.Info(); e == nil {
			size = fi.Size()
			mod = fi.ModTime()
		}
		out.Files = append(out.Files, MemoryNote{
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
		ii := strings.EqualFold(out.Files[i].Path, "MEMORY.md")
		jj := strings.EqualFold(out.Files[j].Path, "MEMORY.md")
		if ii != jj {
			return ii
		}
		if out.Files[i].IsDir != out.Files[j].IsDir {
			return out.Files[i].IsDir
		}
		return strings.ToLower(out.Files[i].Path) < strings.ToLower(out.Files[j].Path)
	})
	return out, nil
}

func memoryNoteAbs(claudeDir, project, rel string) (string, error) {
	if err := validateRelPath(rel); err != nil {
		return "", err
	}
	_, root, err := memoryRoot(claudeDir, project)
	if err != nil {
		return "", err
	}
	target := filepath.Join(root, filepath.Clean(rel))
	if err := ensureUnder(root, target); err != nil {
		return "", err
	}
	return target, nil
}

// ReadMemoryNote 读取一条笔记。
func ReadMemoryNote(claudeDir, project, rel string) (*MemoryNoteContent, error) {
	target, err := memoryNoteAbs(claudeDir, project, rel)
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
	const maxRead = 4 * 1024 * 1024
	if info.Size() > maxRead {
		return nil, fmt.Errorf("文件过大(%d bytes),超过 4 MB 限制", info.Size())
	}
	data, err := os.ReadFile(target)
	if err != nil {
		return nil, err
	}
	return &MemoryNoteContent{
		Project:   project,
		Path:      filepath.ToSlash(rel),
		Content:   string(data),
		Size:      info.Size(),
		UpdatedAt: info.ModTime().UTC().Format(time.RFC3339),
	}, nil
}

// WriteMemoryNote 覆盖/创建一条笔记。
func WriteMemoryNote(claudeDir, project, rel, content string) error {
	target, err := memoryNoteAbs(claudeDir, project, rel)
	if err != nil {
		return err
	}
	const maxWrite = 4 * 1024 * 1024
	if len(content) > maxWrite {
		return fmt.Errorf("内容过大(%d bytes),超过 4 MB 限制", len(content))
	}
	if dir := filepath.Dir(target); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return os.WriteFile(target, []byte(content), 0o644)
}

// DeleteMemoryNote 删除一条笔记或空目录。
func DeleteMemoryNote(claudeDir, project, rel string) error {
	target, err := memoryNoteAbs(claudeDir, project, rel)
	if err != nil {
		return err
	}
	info, err := os.Stat(target)
	if err != nil {
		return err
	}
	if info.IsDir() {
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
