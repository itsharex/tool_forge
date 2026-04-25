package providerswitch

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Service Provider 列表 + 写入官方配置文件的统一入口
type Service struct {
	mu        sync.Mutex
	storeFile string
	providers []Provider

	// claude 写入器(可在测试中替换)
	claudeWriter ClaudeWriter
	codexWriter  CodexWriter
}

// New 创建 service。providers 列表落在 ~/.toolforge/providers.json
func New() (*Service, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(home, ".toolforge")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	s := &Service{
		storeFile:    filepath.Join(dir, "providers.json"),
		claudeWriter: NewClaudeWriter(home),
		codexWriter:  NewCodexWriter(home),
	}
	s.load()
	s.seedDefault()
	return s, nil
}

// seedDefault 启动时补齐 default 条目(每种 CLI 一条),代表
// 用户原本通过 claude /login / codex login 登录的账号。
//
// 已存在(同 ID)则跳过,绝不覆盖用户激活态;
// 同 type 下当前没有任何条目激活时,把 default 设为初始激活态。
func (s *Service) seedDefault() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UnixMilli()
	seeds := []Provider{
		{
			ID:        DefaultClaudeID,
			Name:      "default",
			Type:      TypeClaudeCode,
			IsDefault: true,
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:        DefaultCodexID,
			Name:      "default",
			Type:      TypeCodex,
			IsDefault: true,
			CreatedAt: now,
			UpdatedAt: now,
		},
	}
	changed := false
	for _, seed := range seeds {
		exists := false
		hasActive := false
		for _, p := range s.providers {
			if p.ID == seed.ID {
				exists = true
			}
			// 同 type 下是否已有别的条目激活(包括 codex / codex_oauth)
			if (p.Type == seed.Type ||
				(seed.Type == TypeCodex && p.Type == TypeCodexOAuth)) && p.IsActive {
				hasActive = true
			}
		}
		if !exists {
			if !hasActive {
				seed.IsActive = true
			}
			s.providers = append(s.providers, seed)
			changed = true
		}
	}
	if changed {
		s.persistLocked()
	}
}

// List 返回所有 Provider(按更新时间倒序)
func (s *Service) List() []Provider {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Provider, len(s.providers))
	copy(out, s.providers)
	sort.SliceStable(out, func(i, j int) bool {
		// active 永远在最前
		if out[i].IsActive != out[j].IsActive {
			return out[i].IsActive
		}
		return out[i].UpdatedAt > out[j].UpdatedAt
	})
	return out
}

// ListPresets 返回内置预设
func (s *Service) ListPresets() []Preset {
	out := make([]Preset, len(Presets))
	copy(out, Presets)
	return out
}

// Save 新增或更新一条 Provider。返回保存后的完整记录(含生成的 id)
func (s *Service) Save(p Provider) (Provider, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// default 条目只允许改名,其他字段一律忽略
	for _, x := range s.providers {
		if x.ID == p.ID && x.IsDefault {
			x.Name = strings.TrimSpace(p.Name)
			if x.Name == "" {
				return Provider{}, errors.New("名称不能为空")
			}
			x.UpdatedAt = time.Now().UnixMilli()
			for i := range s.providers {
				if s.providers[i].ID == x.ID {
					s.providers[i] = x
					break
				}
			}
			s.persistLocked()
			return x, nil
		}
	}

	if err := validate(&p); err != nil {
		return Provider{}, err
	}
	now := time.Now().UnixMilli()
	if p.ID == "" {
		p.ID = randID()
		p.CreatedAt = now
	}
	p.UpdatedAt = now

	// 更新或追加
	found := false
	for i, x := range s.providers {
		if x.ID == p.ID {
			// 保留 IsActive 和 CreatedAt
			p.IsActive = x.IsActive
			if p.CreatedAt == 0 {
				p.CreatedAt = x.CreatedAt
			}
			s.providers[i] = p
			found = true
			break
		}
	}
	if !found {
		if p.CreatedAt == 0 {
			p.CreatedAt = now
		}
		s.providers = append(s.providers, p)
	}
	s.persistLocked()
	return p, nil
}

// Delete 删除 Provider。default 条目不可删
func (s *Service) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.providers {
		if p.ID == id && p.IsDefault {
			return errors.New("default 条目不可删除")
		}
	}
	out := s.providers[:0]
	for _, p := range s.providers {
		if p.ID == id {
			continue
		}
		out = append(out, p)
	}
	s.providers = out
	s.persistLocked()
	return nil
}

// Activate 把指定 Provider 设为激活态,并把配置写入官方文件
func (s *Service) Activate(id string) ApplyResult {
	s.mu.Lock()
	target, idx := s.findLocked(id)
	if idx < 0 {
		s.mu.Unlock()
		return ApplyResult{OK: false, Message: "Provider 不存在"}
	}
	// 先解锁再做 IO,避免长时间持锁
	provider := *target
	s.mu.Unlock()

	var result ApplyResult
	switch provider.Type {
	case TypeClaudeCode:
		written, backup, err := s.claudeWriter.Apply(provider)
		if err != nil {
			result = ApplyResult{OK: false, Message: err.Error()}
		} else {
			result = ApplyResult{OK: true, WrittenTo: written, BackupPath: backup, Message: "已写入 ~/.claude/settings.json"}
		}
	case TypeCodex, TypeCodexOAuth:
		written, backup, err := s.codexWriter.Apply(provider)
		if err != nil {
			result = ApplyResult{OK: false, Message: err.Error()}
		} else {
			result = ApplyResult{OK: true, WrittenTo: written, BackupPath: backup, Message: "已写入 ~/.codex/config.toml"}
		}
	default:
		result = ApplyResult{OK: false, Message: "未知 Provider 类型: " + string(provider.Type)}
	}

	if !result.OK {
		return result
	}

	// 写成功后再更新 active 状态(同 type 下只能有一个 active)
	s.mu.Lock()
	// codex / codex_oauth 视为同一组
	sameGroup := func(a, b ProviderType) bool {
		if a == b {
			return true
		}
		if (a == TypeCodex && b == TypeCodexOAuth) || (a == TypeCodexOAuth && b == TypeCodex) {
			return true
		}
		return false
	}
	for i := range s.providers {
		if sameGroup(s.providers[i].Type, provider.Type) {
			s.providers[i].IsActive = (s.providers[i].ID == id)
		}
	}
	s.persistLocked()
	s.mu.Unlock()
	return result
}

// Test 用 baseUrl + apiKey 发一个 max_tokens=1 的 ping
func (s *Service) Test(p Provider) TestResult {
	if p.IsDefault {
		return TestResult{OK: false, Message: "default 条目走本机 CLI 自带的 OAuth 登录态,此处无法直接探测;激活后用 claude / codex 命令验证即可"}
	}
	if err := validate(&p); err != nil {
		return TestResult{OK: false, Message: err.Error()}
	}
	switch p.Type {
	case TypeClaudeCode:
		return testClaude(p)
	case TypeCodex, TypeCodexOAuth:
		return testCodex(p)
	default:
		return TestResult{OK: false, Message: "未知 Provider 类型"}
	}
}

// GetActiveConfig 读当前 ~/.claude/settings.json 的 env 块,
// 用来在 UI 上提示"当前真正生效的配置"
func (s *Service) GetActiveConfig(t ProviderType) map[string]string {
	switch t {
	case TypeClaudeCode:
		return s.claudeWriter.ReadEnv()
	case TypeCodex, TypeCodexOAuth:
		return s.codexWriter.ReadActive()
	}
	return nil
}

// ---------- internal ----------

func (s *Service) findLocked(id string) (*Provider, int) {
	for i := range s.providers {
		if s.providers[i].ID == id {
			return &s.providers[i], i
		}
	}
	return nil, -1
}

func (s *Service) persistLocked() {
	if s.storeFile == "" {
		return
	}
	data, _ := json.MarshalIndent(s.providers, "", "  ")
	tmp := s.storeFile + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return
	}
	_ = os.Rename(tmp, s.storeFile)
}

func (s *Service) load() {
	data, err := os.ReadFile(s.storeFile)
	if err != nil {
		return
	}
	// 兼容上一版字段名:isOfficial → isDefault,id 也从 official-* 迁到 default-*
	type legacyProvider struct {
		Provider
		IsOfficial bool `json:"isOfficial"`
	}
	var legacy []legacyProvider
	if err := json.Unmarshal(data, &legacy); err != nil {
		return
	}
	migrated := false
	migratedList := make([]Provider, 0, len(legacy))
	for _, lp := range legacy {
		p := lp.Provider
		if lp.IsOfficial && !p.IsDefault {
			p.IsDefault = true
			migrated = true
		}
		switch p.ID {
		case "official-claude":
			p.ID = DefaultClaudeID
			p.Name = "default"
			p.IsDefault = true
			migrated = true
		case "official-codex":
			p.ID = DefaultCodexID
			p.Name = "default"
			p.IsDefault = true
			migrated = true
		}
		migratedList = append(migratedList, p)
	}

	// 去重:同 ID 只保留一条;优先 IsActive=true,其次更晚的 UpdatedAt
	seen := map[string]int{} // id → index in out
	out := make([]Provider, 0, len(migratedList))
	for _, p := range migratedList {
		if idx, ok := seen[p.ID]; ok {
			migrated = true // 触发 persist 把去重结果写回
			cur := out[idx]
			// 选更"权威"的那条:active 优先,然后 updatedAt 大的
			if p.IsActive && !cur.IsActive {
				out[idx] = p
			} else if p.IsActive == cur.IsActive && p.UpdatedAt > cur.UpdatedAt {
				out[idx] = p
			}
			continue
		}
		seen[p.ID] = len(out)
		out = append(out, p)
	}

	s.providers = out
	if migrated {
		s.persistLocked()
	}
}

func validate(p *Provider) error {
	if p.Name == "" {
		return errors.New("名称不能为空")
	}
	if p.Type == "" {
		return errors.New("Provider 类型不能为空")
	}
	if p.BaseURL == "" {
		return errors.New("Base URL 不能为空")
	}
	if p.Type == TypeClaudeCode || p.Type == TypeCodex {
		if p.APIKey == "" {
			return errors.New("API Key 不能为空")
		}
	}
	if p.Type == TypeCodexOAuth {
		if p.OAuthAccessToken == "" {
			return errors.New("OAuth Access Token 不能为空")
		}
	}
	return nil
}

func randID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("p_%d", time.Now().UnixNano())
	}
	return "p_" + hex.EncodeToString(b)
}
