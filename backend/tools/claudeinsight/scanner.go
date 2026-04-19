package claudeinsight

import (
	"bufio"
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

// maxScanTokenSize 单行 JSONL 最大 8 MiB——有些会话的 base64 图片可以很大。
const maxScanTokenSize = 8 * 1024 * 1024

// sessionEvent 只关心构成统计所需的字段;其他字段跳过即可。
type sessionEvent struct {
	Type      string          `json:"type"`
	Timestamp string          `json:"timestamp"`
	SessionID string          `json:"sessionId"`
	Cwd       string          `json:"cwd"`
	Message   json.RawMessage `json:"message"`
}

type assistantMessage struct {
	Model string `json:"model"`
	Usage struct {
		InputTokens              int64 `json:"input_tokens"`
		OutputTokens             int64 `json:"output_tokens"`
		CacheCreationInputTokens int64 `json:"cache_creation_input_tokens"`
		CacheReadInputTokens     int64 `json:"cache_read_input_tokens"`
	} `json:"usage"`
}

// sessionAccum 扫描单个 jsonl 文件累积出的中间态
type sessionAccum struct {
	id        string
	project   string
	filePath  string
	messages  int
	firstTime time.Time
	lastTime  time.Time
	// preview: 第一条 user 消息的文本(截断),供会话列表展示
	preview string
	// 每小时(本地时区)的消息数
	hourDist [24]int
	// 每天(本地时区)的消息数
	perDay map[string]int
	// 模型级 token
	byModel map[string]*ModelTokens
}

// BuildDashboard 扫描 claudeDir/projects 下所有 *.jsonl,聚合出 Dashboard。
// claudeDir 为空时使用 $HOME/.claude 默认位置。
func BuildDashboard(claudeDir string) (*DashboardReport, error) {
	dir, accums, err := scanAll(claudeDir)
	if err != nil {
		return nil, err
	}
	if accums == nil {
		return emptyReport(dir), nil
	}
	return aggregate(accums, dir), nil
}

// ListSessions 返回按结束时间倒序的会话列表,用于会话浏览页。
func ListSessions(claudeDir string) (*SessionList, error) {
	dir, accums, err := scanAll(claudeDir)
	if err != nil {
		return nil, err
	}
	out := &SessionList{
		ClaudeDir: dir,
		ScannedAt: time.Now().UTC().Format(time.RFC3339),
		Items:     make([]SessionListItem, 0, len(accums)),
	}
	for _, acc := range accums {
		out.Items = append(out.Items, SessionListItem{
			ID:        acc.id,
			Project:   acc.project,
			StartedAt: acc.firstTime.UTC().Format(time.RFC3339),
			EndedAt:   acc.lastTime.UTC().Format(time.RFC3339),
			Messages:  acc.messages,
			Preview:   acc.preview,
			FilePath:  acc.filePath,
		})
	}
	// 按结束时间倒序
	sort.Slice(out.Items, func(i, j int) bool {
		return out.Items[i].EndedAt > out.Items[j].EndedAt
	})
	return out, nil
}

// scanAll 是 BuildDashboard / ListSessions 共享的底层扫描:
// 解析 claudeDir、发现所有 .jsonl、并发扫描、返回有消息的 accum。
// 项目目录不存在时返回 (dir, nil, nil)。
func scanAll(claudeDir string) (string, []*sessionAccum, error) {
	dir, err := resolveClaudeDir(claudeDir)
	if err != nil {
		return "", nil, err
	}
	projectsDir := filepath.Join(dir, "projects")
	info, err := os.Stat(projectsDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return dir, nil, nil
		}
		return dir, nil, err
	}
	if !info.IsDir() {
		return dir, nil, fmt.Errorf("%s 不是一个目录", projectsDir)
	}

	files, err := collectJSONLFiles(projectsDir)
	if err != nil {
		return dir, nil, err
	}

	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup
	var mu sync.Mutex
	accums := make([]*sessionAccum, 0, len(files))

	for _, p := range files {
		wg.Add(1)
		sem <- struct{}{}
		go func(path string) {
			defer wg.Done()
			defer func() { <-sem }()
			acc, err := scanSessionFile(path)
			if err != nil || acc == nil || acc.messages == 0 {
				return
			}
			mu.Lock()
			accums = append(accums, acc)
			mu.Unlock()
		}(p)
	}
	wg.Wait()
	return dir, accums, nil
}

func resolveClaudeDir(custom string) (string, error) {
	if strings.TrimSpace(custom) != "" {
		return custom, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".claude"), nil
}

func collectJSONLFiles(projectsDir string) ([]string, error) {
	var out []string
	err := filepath.WalkDir(projectsDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			// 跳过不可读的子项,不中断整体扫描
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
		byModel:  make(map[string]*ModelTokens),
	}

	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var ev sessionEvent
		if err := json.Unmarshal(line, &ev); err != nil {
			continue // 坏行跳过,不影响其他事件
		}

		// 填充 session 元信息(首次看到就记)
		if acc.id == "" && ev.SessionID != "" {
			acc.id = ev.SessionID
		}
		if acc.project == "" && ev.Cwd != "" {
			acc.project = ev.Cwd
		}

		// 只有 user / assistant 两种类型计入消息统计
		if ev.Type != "user" && ev.Type != "assistant" {
			continue
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

		if ev.Type == "assistant" && len(ev.Message) > 0 {
			var am assistantMessage
			if err := json.Unmarshal(ev.Message, &am); err == nil && am.Model != "" {
				mt := acc.byModel[am.Model]
				if mt == nil {
					mt = &ModelTokens{Model: am.Model}
					acc.byModel[am.Model] = mt
				}
				mt.InputTokens += am.Usage.InputTokens
				mt.OutputTokens += am.Usage.OutputTokens
				mt.CacheCreationTokens += am.Usage.CacheCreationInputTokens
				mt.CacheReadTokens += am.Usage.CacheReadInputTokens
				mt.Messages++
			}
		}

		// 取第一条 user 消息文本做预览
		if acc.preview == "" && ev.Type == "user" && len(ev.Message) > 0 {
			acc.preview = extractUserText(ev.Message)
		}
	}
	// Scanner.Err() 除了 token too long 外的错误忽略——返回部分结果比整体失败要好
	return acc, nil
}

// extractUserText 从 user 事件的 message 字段里抽文本。
// user 的 message.content 可能是 string,也可能是 [{type:"text", text:"..."}] 数组。
// 取到第一段 text,trim 并截断到 200 字符。
func extractUserText(raw json.RawMessage) string {
	var envelope struct {
		Content json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return ""
	}
	if len(envelope.Content) == 0 {
		return ""
	}
	// 形态一: string
	var asStr string
	if err := json.Unmarshal(envelope.Content, &asStr); err == nil {
		return truncatePreview(asStr)
	}
	// 形态二: 数组
	var asArr []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(envelope.Content, &asArr); err == nil {
		for _, part := range asArr {
			if part.Type == "text" && strings.TrimSpace(part.Text) != "" {
				return truncatePreview(part.Text)
			}
		}
	}
	return ""
}

func truncatePreview(s string) string {
	trimmed := strings.TrimSpace(s)
	// 去掉 Claude Code 自动注入的 <command-xxx>、<system-reminder>、<local-command-stdout> 等块,
	// 这类预览对用户识别会话没意义。
	if strings.HasPrefix(trimmed, "<") {
		return ""
	}
	// 压缩连续空白为单空格,预览一行显示更干净
	runes := []rune(trimmed)
	const limit = 200
	if len(runes) > limit {
		return string(runes[:limit]) + "..."
	}
	return trimmed
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

func aggregate(accums []*sessionAccum, claudeDir string) *DashboardReport {
	now := time.Now()
	r := &DashboardReport{
		ClaudeDir: claudeDir,
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

		// 按天聚合:session 计数每个 session 贡献的"活跃天"集合
		daysTouchedBySession := map[string]struct{}{}
		for day, n := range acc.perDay {
			b := perDay[day]
			if b == nil {
				b = &DailyBucket{Date: day}
				perDay[day] = b
			}
			b.Messages += n
			if _, seen := daysTouchedBySession[day]; !seen {
				b.Sessions++
				daysTouchedBySession[day] = struct{}{}
			}
		}

		for i := 0; i < 24; i++ {
			hourDist[i] += acc.hourDist[i]
		}
		for model, mt := range acc.byModel {
			dest := tokensByModel[model]
			if dest == nil {
				dest = &ModelTokens{Model: model}
				tokensByModel[model] = dest
			}
			dest.InputTokens += mt.InputTokens
			dest.OutputTokens += mt.OutputTokens
			dest.CacheCreationTokens += mt.CacheCreationTokens
			dest.CacheReadTokens += mt.CacheReadTokens
			dest.Messages += mt.Messages
		}

		summary := SessionSummary{
			ID:          acc.id,
			Project:     acc.project,
			StartedAt:   acc.firstTime.UTC().Format(time.RFC3339),
			EndedAt:     acc.lastTime.UTC().Format(time.RFC3339),
			Messages:    acc.messages,
			DurationSec: int64(acc.lastTime.Sub(acc.firstTime).Seconds()),
		}
		recents = append(recents, summary)
		if longest == nil || summary.Messages > longest.Messages {
			s := summary
			longest = &s
		}
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

	// 近 7 天(含今天)按日期升序填满
	r.Last7Days = make([]DailyBucket, 0, 7)
	for i := 6; i >= 0; i-- {
		d := now.AddDate(0, 0, -i).Local().Format("2006-01-02")
		if b, ok := perDay[d]; ok {
			r.Last7Days = append(r.Last7Days, *b)
		} else {
			r.Last7Days = append(r.Last7Days, DailyBucket{Date: d})
		}
	}

	// 日历:只返回近 365 天内有记录的天,按日期升序
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

	// tokens_by_model 按总 token 量降序
	tbm := make([]ModelTokens, 0, len(tokensByModel))
	for _, mt := range tokensByModel {
		tbm = append(tbm, *mt)
	}
	sort.Slice(tbm, func(i, j int) bool {
		return totalTokens(tbm[i]) > totalTokens(tbm[j])
	})
	r.TokensByModel = tbm

	// recent_sessions 按结束时间倒序,截取前 10 条
	sort.Slice(recents, func(i, j int) bool {
		return recents[i].EndedAt > recents[j].EndedAt
	})
	if len(recents) > 10 {
		recents = recents[:10]
	}
	r.RecentSessions = recents

	return r
}

func totalTokens(m ModelTokens) int64 {
	return m.InputTokens + m.OutputTokens + m.CacheCreationTokens + m.CacheReadTokens
}

func emptyReport(claudeDir string) *DashboardReport {
	return fillLast7Days(&DashboardReport{
		ClaudeDir: claudeDir,
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
	return r
}
