package codexinsight

import (
	"bufio"
	"bytes"
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

// encryptedMarker Codex 的 reasoning 事件 payload 里带 encrypted_content,
// 单行可达几万字符且对 Dashboard/搜索完全无用,提前字节级跳过。
var encryptedMarker = []byte(`"encrypted_content"`)

// cachedAccum 文件级缓存项:按 (mtime, size) 指纹判断是否还有效。
type cachedAccum struct {
	mtime time.Time
	size  int64
	accum *sessionAccum
}

// fileCache Codex jsonl 每个文件扫描结果的内存缓存。首次扫描全量 745MB+ 要几秒,
// 后续切 Tab / 刷新时按 mtime+size 快速比对,未变动就命中,只重新扫新增/改过的文件。
var (
	fileCacheMu sync.RWMutex
	fileCache   = make(map[string]cachedAccum)
)

const maxScanTokenSize = 8 * 1024 * 1024

// sessionAccum 扫描单个 jsonl 累积的中间态
type sessionAccum struct {
	id          string
	project     string
	filePath    string
	messages    int
	firstTime   time.Time
	lastTime    time.Time
	preview     string
	lastModel   string  // 最后一次 turn_context.model
	cliVersion  string
	hourDist    [24]int
	perDay      map[string]int
	// token_count 事件 total_token_usage 的最后一次值——Codex 的 token 是 session 级 running total
	tokens struct {
		Input     int64
		Output    int64
		Cached    int64
		Reasoning int64
		Total     int64
		Seen      bool
	}
}

// resolveCodexDir 解析 ~/.codex,允许 custom 覆盖
func resolveCodexDir(custom string) (string, error) {
	if strings.TrimSpace(custom) != "" {
		return custom, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".codex"), nil
}

func collectJSONLFiles(sessionsDir string) ([]string, error) {
	var out []string
	err := filepath.WalkDir(sessionsDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if strings.HasSuffix(strings.ToLower(d.Name()), ".jsonl") {
			out = append(out, path)
		}
		return nil
	})
	return out, err
}

// scanAll 共享的底层扫描:发现所有 .jsonl 并并发处理。
// 若 sessions 目录不存在返回 (codexDir, nil, nil)。
func scanAll(custom string) (string, []*sessionAccum, error) {
	dir, err := resolveCodexDir(custom)
	if err != nil {
		return "", nil, err
	}
	sessionsDir := filepath.Join(dir, "sessions")
	info, err := os.Stat(sessionsDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return dir, nil, nil
		}
		return dir, nil, err
	}
	if !info.IsDir() {
		return dir, nil, fmt.Errorf("%s 不是目录", sessionsDir)
	}

	files, err := collectJSONLFiles(sessionsDir)
	if err != nil {
		return dir, nil, err
	}

	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup
	var mu sync.Mutex
	accums := make([]*sessionAccum, 0, len(files))

	// 记录本轮见到的文件集,扫完后把缓存里不再存在的条目剔除
	seen := make(map[string]struct{}, len(files))

	for _, p := range files {
		seen[p] = struct{}{}
		wg.Add(1)
		sem <- struct{}{}
		go func(path string) {
			defer wg.Done()
			defer func() { <-sem }()
			acc := scanOrCache(path)
			if acc == nil || acc.messages == 0 {
				return
			}
			mu.Lock()
			accums = append(accums, acc)
			mu.Unlock()
		}(p)
	}
	wg.Wait()

	// 清理已删除文件对应的缓存项(防止内存无限增长)
	fileCacheMu.Lock()
	for k := range fileCache {
		if _, ok := seen[k]; !ok {
			delete(fileCache, k)
		}
	}
	fileCacheMu.Unlock()
	return dir, accums, nil
}

// scanOrCache 对单个文件,先按 mtime+size 查缓存;命中则直接返回,否则扫描并写缓存。
func scanOrCache(path string) *sessionAccum {
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	fileCacheMu.RLock()
	c, ok := fileCache[path]
	fileCacheMu.RUnlock()
	if ok && c.size == info.Size() && c.mtime.Equal(info.ModTime()) {
		return c.accum
	}
	acc, err := scanSessionFile(path)
	if err != nil || acc == nil {
		return nil
	}
	fileCacheMu.Lock()
	fileCache[path] = cachedAccum{
		mtime: info.ModTime(),
		size:  info.Size(),
		accum: acc,
	}
	fileCacheMu.Unlock()
	return acc
}

// scanSessionFile 扫单个会话 jsonl。只计 response_item 里的 message 作为消息,
// 追踪 turn_context.model,最后一次 token_count 作为 session token 总数。
func scanSessionFile(path string) (*sessionAccum, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	buf := make([]byte, 0, 64*1024)
	sc.Buffer(buf, maxScanTokenSize)

	acc := &sessionAccum{
		filePath: path,
		perDay:   make(map[string]int),
	}
	currentModel := ""

	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		// 字节级预筛:含 encrypted_content 的行是 reasoning,Dashboard 不需要。
		// Codex 的 jsonl 大头(常占 50%+ 字节量)就是这一类,跳过能显著提速。
		if bytes.Contains(line, encryptedMarker) {
			continue
		}
		var ev struct {
			Timestamp string          `json:"timestamp"`
			Type      string          `json:"type"`
			Payload   json.RawMessage `json:"payload"`
		}
		if err := json.Unmarshal(line, &ev); err != nil {
			continue
		}

		switch ev.Type {
		case "session_meta":
			var p struct {
				ID         string `json:"id"`
				Cwd        string `json:"cwd"`
				CliVersion string `json:"cli_version"`
			}
			if err := json.Unmarshal(ev.Payload, &p); err == nil {
				if acc.id == "" {
					acc.id = p.ID
				}
				if acc.project == "" {
					acc.project = p.Cwd
				}
				if acc.cliVersion == "" {
					acc.cliVersion = p.CliVersion
				}
			}

		case "turn_context":
			var p struct {
				Cwd   string `json:"cwd"`
				Model string `json:"model"`
			}
			if err := json.Unmarshal(ev.Payload, &p); err == nil {
				if p.Model != "" {
					currentModel = p.Model
					acc.lastModel = p.Model
				}
				if acc.project == "" && p.Cwd != "" {
					acc.project = p.Cwd
				}
			}

		case "response_item":
			// 只关心 payload.type="message" 作为消息计数
			var p struct {
				Type    string          `json:"type"`
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			}
			if err := json.Unmarshal(ev.Payload, &p); err != nil {
				continue
			}
			if p.Type != "message" {
				continue
			}
			if p.Role != "user" && p.Role != "assistant" {
				continue
			}

			// 过滤 user 侧 <environment_context>... 这种自动注入
			userText := ""
			if p.Role == "user" {
				userText = firstUserText(p.Content)
				if userText == "" || strings.HasPrefix(strings.TrimSpace(userText), "<environment_context>") {
					continue
				}
			}

			ts, ok := parseTime(ev.Timestamp)
			if !ok {
				continue
			}
			local := ts.Local()

			if acc.firstTime.IsZero() || ts.Before(acc.firstTime) {
				acc.firstTime = ts
			}
			if ts.After(acc.lastTime) {
				acc.lastTime = ts
			}
			acc.messages++
			acc.hourDist[local.Hour()]++
			acc.perDay[local.Format("2006-01-02")]++

			if p.Role == "user" && acc.preview == "" && userText != "" {
				acc.preview = truncatePreview(userText)
			}
			_ = currentModel // model 挂在每条消息的 loadSession 逻辑里,这里 scanner 只记最后一次

		case "event_msg":
			// 只读 token_count
			var p struct {
				Type string `json:"type"`
				Info struct {
					TotalTokenUsage struct {
						InputTokens           int64 `json:"input_tokens"`
						CachedInputTokens     int64 `json:"cached_input_tokens"`
						OutputTokens          int64 `json:"output_tokens"`
						ReasoningOutputTokens int64 `json:"reasoning_output_tokens"`
						TotalTokens           int64 `json:"total_tokens"`
					} `json:"total_token_usage"`
				} `json:"info"`
			}
			if err := json.Unmarshal(ev.Payload, &p); err != nil {
				continue
			}
			if p.Type != "token_count" {
				continue
			}
			u := p.Info.TotalTokenUsage
			// running total:总是用最后一次看到的
			acc.tokens.Input = u.InputTokens
			acc.tokens.Cached = u.CachedInputTokens
			acc.tokens.Output = u.OutputTokens
			acc.tokens.Reasoning = u.ReasoningOutputTokens
			acc.tokens.Total = u.TotalTokens
			acc.tokens.Seen = true
		}
	}
	return acc, nil
}

func parseTime(s string) (time.Time, bool) {
	if s == "" {
		return time.Time{}, false
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t, true
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, true
	}
	return time.Time{}, false
}

// firstUserText 从 user response_item.content 里取第一段 input_text 文本。
func firstUserText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	// content 总是数组
	var arr []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &arr); err != nil {
		return ""
	}
	for _, p := range arr {
		if p.Type == "input_text" && strings.TrimSpace(p.Text) != "" {
			return p.Text
		}
	}
	return ""
}

func truncatePreview(s string) string {
	trimmed := strings.TrimSpace(s)
	runes := []rune(trimmed)
	const limit = 200
	if len(runes) > limit {
		return string(runes[:limit]) + "..."
	}
	return trimmed
}

// ---- 公共 API ----

// BuildDashboard 扫描所有 session,聚合 Dashboard 数据
func BuildDashboard(codexDir string) (*DashboardReport, error) {
	dir, accums, err := scanAll(codexDir)
	if err != nil {
		return nil, err
	}
	if accums == nil {
		return emptyReport(dir), nil
	}
	return aggregate(accums, dir), nil
}

// ListSessions 返回按结束时间倒序的会话列表
func ListSessions(codexDir string) (*SessionList, error) {
	dir, accums, err := scanAll(codexDir)
	if err != nil {
		return nil, err
	}
	out := &SessionList{
		CodexDir:  dir,
		ScannedAt: time.Now().UTC().Format(time.RFC3339),
		Items:     make([]SessionListItem, 0, len(accums)),
	}
	for _, acc := range accums {
		out.Items = append(out.Items, SessionListItem{
			ID:              acc.id,
			Project:         acc.project,
			StartedAt:       acc.firstTime.UTC().Format(time.RFC3339),
			EndedAt:         acc.lastTime.UTC().Format(time.RFC3339),
			Messages:        acc.messages,
			Preview:         acc.preview,
			FilePath:        acc.filePath,
			Model:           acc.lastModel,
			Cli:             acc.cliVersion,
			InputTokens:     acc.tokens.Input,
			OutputTokens:    acc.tokens.Output,
			CachedTokens:    acc.tokens.Cached,
			ReasoningTokens: acc.tokens.Reasoning,
			TotalTokens:     acc.tokens.Total,
		})
	}
	sort.Slice(out.Items, func(i, j int) bool {
		return out.Items[i].EndedAt > out.Items[j].EndedAt
	})
	return out, nil
}

func aggregate(accums []*sessionAccum, codexDir string) *DashboardReport {
	now := time.Now()
	r := &DashboardReport{
		CodexDir:  codexDir,
		ScannedAt: now.UTC().Format(time.RFC3339),
	}
	if len(accums) == 0 {
		return fillLast7Days(r, now)
	}

	perDay := make(map[string]*DailyBucket)
	hourDist := [24]int{}
	tokensByModel := make(map[string]*ModelTokens)

	var firstTime, lastTime time.Time
	var longest *SessionSummary
	recents := make([]SessionSummary, 0, len(accums))

	for _, acc := range accums {
		r.TotalSessions++
		r.TotalMessages += acc.messages

		if firstTime.IsZero() || acc.firstTime.Before(firstTime) {
			firstTime = acc.firstTime
		}
		if acc.lastTime.After(lastTime) {
			lastTime = acc.lastTime
		}

		daysTouched := map[string]struct{}{}
		for day, n := range acc.perDay {
			b := perDay[day]
			if b == nil {
				b = &DailyBucket{Date: day}
				perDay[day] = b
			}
			b.Messages += n
			if _, seen := daysTouched[day]; !seen {
				b.Sessions++
				daysTouched[day] = struct{}{}
			}
		}
		for i := 0; i < 24; i++ {
			hourDist[i] += acc.hourDist[i]
		}

		// token 归属:最后一次 turn_context 的 model
		model := acc.lastModel
		if model == "" {
			model = "unknown"
		}
		if acc.tokens.Seen {
			mt := tokensByModel[model]
			if mt == nil {
				mt = &ModelTokens{Model: model}
				tokensByModel[model] = mt
			}
			mt.InputTokens += acc.tokens.Input
			mt.OutputTokens += acc.tokens.Output
			mt.CachedTokens += acc.tokens.Cached
			mt.ReasoningTokens += acc.tokens.Reasoning
			mt.Sessions++
		}

		summary := SessionSummary{
			ID:          acc.id,
			Project:     acc.project,
			StartedAt:   acc.firstTime.UTC().Format(time.RFC3339),
			EndedAt:     acc.lastTime.UTC().Format(time.RFC3339),
			Messages:    acc.messages,
			DurationSec: int64(acc.lastTime.Sub(acc.firstTime).Seconds()),
			Model:       acc.lastModel,
		}
		recents = append(recents, summary)
		if longest == nil || summary.Messages > longest.Messages {
			s := summary
			longest = &s
		}
	}

	// Top 项目排行(按消息数降序)
	projectAgg := map[string]*ProjectStat{}
	for _, acc := range accums {
		proj := acc.project
		if proj == "" {
			proj = "（未知）"
		}
		ps := projectAgg[proj]
		if ps == nil {
			ps = &ProjectStat{Project: proj}
			projectAgg[proj] = ps
		}
		ps.Sessions++
		ps.Messages += acc.messages
	}
	topProjects := make([]ProjectStat, 0, len(projectAgg))
	for _, ps := range projectAgg {
		topProjects = append(topProjects, *ps)
	}
	sort.Slice(topProjects, func(i, j int) bool {
		return topProjects[i].Messages > topProjects[j].Messages
	})
	if len(topProjects) > 8 {
		topProjects = topProjects[:8]
	}
	r.TopProjects = topProjects

	// Token 按天走势(近 30 天):每个 session 的 token 归属到 session 结束那天
	trendMap := map[string]int64{}
	for _, acc := range accums {
		if !acc.tokens.Seen || acc.lastTime.IsZero() {
			continue
		}
		day := acc.lastTime.Local().Format("2006-01-02")
		trendMap[day] += acc.tokens.Total
	}
	r.TokenTrend = make([]DailyTokens, 0, 30)
	for i := 29; i >= 0; i-- {
		d := now.AddDate(0, 0, -i).Local().Format("2006-01-02")
		r.TokenTrend = append(r.TokenTrend, DailyTokens{Date: d, Tokens: trendMap[d]})
	}

	r.ActiveDays = len(perDay)
	if !firstTime.IsZero() {
		r.FirstUsedAt = firstTime.UTC().Format(time.RFC3339)
	}
	if !lastTime.IsZero() {
		r.LastUsedAt = lastTime.UTC().Format(time.RFC3339)
	}
	r.HourDistribution = hourDist
	r.LongestSession = longest

	r.Last7Days = make([]DailyBucket, 0, 7)
	for i := 6; i >= 0; i-- {
		d := now.AddDate(0, 0, -i).Local().Format("2006-01-02")
		if b, ok := perDay[d]; ok {
			r.Last7Days = append(r.Last7Days, *b)
		} else {
			r.Last7Days = append(r.Last7Days, DailyBucket{Date: d})
		}
	}

	cutoff := now.AddDate(0, 0, -364).Local().Format("2006-01-02")
	cal := make([]DailyBucket, 0, len(perDay))
	for date, b := range perDay {
		if date < cutoff {
			continue
		}
		cal = append(cal, *b)
	}
	sort.Slice(cal, func(i, j int) bool { return cal[i].Date < cal[j].Date })
	r.Calendar = cal

	tbm := make([]ModelTokens, 0, len(tokensByModel))
	for _, mt := range tokensByModel {
		tbm = append(tbm, *mt)
	}
	sort.Slice(tbm, func(i, j int) bool { return totalTokens(tbm[i]) > totalTokens(tbm[j]) })
	r.TokensByModel = tbm

	sort.Slice(recents, func(i, j int) bool { return recents[i].EndedAt > recents[j].EndedAt })
	if len(recents) > 10 {
		recents = recents[:10]
	}
	r.RecentSessions = recents
	return r
}

func totalTokens(m ModelTokens) int64 {
	return m.InputTokens + m.OutputTokens + m.CachedTokens + m.ReasoningTokens
}

func emptyReport(codexDir string) *DashboardReport {
	return fillLast7Days(&DashboardReport{
		CodexDir:  codexDir,
		ScannedAt: time.Now().UTC().Format(time.RFC3339),
	}, time.Now())
}

func fillLast7Days(r *DashboardReport, now time.Time) *DashboardReport {
	r.Last7Days = make([]DailyBucket, 0, 7)
	for i := 6; i >= 0; i-- {
		d := now.AddDate(0, 0, -i).Local().Format("2006-01-02")
		r.Last7Days = append(r.Last7Days, DailyBucket{Date: d})
	}
	r.Calendar = []DailyBucket{}
	r.TokensByModel = []ModelTokens{}
	r.RecentSessions = []SessionSummary{}
	r.TopProjects = []ProjectStat{}
	r.TokenTrend = make([]DailyTokens, 0, 30)
	for i := 29; i >= 0; i-- {
		d := now.AddDate(0, 0, -i).Local().Format("2006-01-02")
		r.TokenTrend = append(r.TokenTrend, DailyTokens{Date: d})
	}
	return r
}
