package sqlitex

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	// defaultPageRows 浏览时一页多少行
	defaultPageRows = 200
	// maxPageRows 一页最多多少行,防着有人传个十万进来
	maxPageRows = 2000
	// maxCellText 单元格文本最多留多长。
	// 证据库里躺着几 MB 的 JSON 和 base64 很常见,原样带回前端只会把界面卡死
	maxCellText = 2000
	// blobPeek BLOB 摘要里看前多少字节
	blobPeek = 24
	// searchWorkers 同时搜几个库
	searchWorkers = 4
	// maxFileSize 超过这个大小的文件不当 SQLite 试。
	// 纯粹是省时间:遍历时每个文件都要读头,而 2GB 的视频显然不是库
	maxFileSize = 8 << 30
)

// SearchOptions 一次搜索的参数
type SearchOptions struct {
	// Root 搜哪儿。可以是一个 db 文件,也可以是整个导出目录
	Root string `json:"root"`
	// Keywords 关键词,任意一个命中即可
	Keywords []string `json:"keywords"`
	// MaxHitsPerTable 每张表最多取几行,0 = 默认
	MaxHitsPerTable int `json:"maxHitsPerTable"`
	// MaxHits 总共最多取几行,0 = 默认
	MaxHits int `json:"maxHits"`
	// CaseSensitive 区分大小写。默认不分 —— LIKE 在 SQLite 里对
	// ASCII 本来就不分大小写,这个开关只影响我们自己那一遍复核
	CaseSensitive bool `json:"caseSensitive"`
}

// SearchResult 搜索结果
type SearchResult struct {
	Hits []Hit `json:"hits"`
	// Files 扫了多少个库
	Files int `json:"files"`
	// Skipped 打不开的库,以及为什么
	Skipped []SkippedFile `json:"skipped"`
	// Truncated 到上限提前停了
	Truncated bool `json:"truncated"`
	// Elapsed 耗时,毫秒
	Elapsed int64 `json:"elapsedMs"`
}

// Hit 一条命中。给的是整行,不只是"这张表有"
type Hit struct {
	// File 库的路径(相对 Root)
	File  string `json:"file"`
	Table string `json:"table"`
	// Column 命中的是哪一列。一行里多列命中时取第一个
	Column  string   `json:"column"`
	Keyword string   `json:"keyword"`
	Columns []string `json:"columns"`
	Row     []Cell   `json:"row"`
}

// SkippedFile 没搜成的库
type SkippedFile struct {
	File   string `json:"file"`
	Reason string `json:"reason"`
}

// Search 在一个文件或一整棵目录树里按关键词搜 SQLite 库。
//
// 和"一列一个查询"的做法不同,这里**一张表只发一次查询**:
// 所有列 OR 起来、所有关键词 OR 起来。一个五十张表二十列的库配三个关键词,
// 前者要三千次查询,这里五十次。库多起来时这个差别是分钟和小时的差别。
//
// 而且返回的是命中的**整行**。只报"某表某列有"对取证没什么用 ——
// 真正要的是那一行写了什么。
func Search(ctx context.Context, opt SearchOptions) (*SearchResult, error) {
	started := time.Now()
	keywords := cleanKeywords(opt.Keywords)
	if len(keywords) == 0 {
		return nil, fmt.Errorf("没给关键词")
	}
	if opt.MaxHitsPerTable <= 0 {
		opt.MaxHitsPerTable = 50
	}
	if opt.MaxHits <= 0 {
		opt.MaxHits = 500
	}

	files, err := collectDBs(ctx, opt.Root)
	if err != nil {
		return nil, err
	}
	res := &SearchResult{Hits: []Hit{}, Skipped: []SkippedFile{}, Files: len(files)}

	var (
		mu   sync.Mutex
		wg   sync.WaitGroup
		jobs = make(chan string)
	)
	for i := 0; i < searchWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for f := range jobs {
				hits, err := searchOne(ctx, f, opt.Root, keywords, opt)
				mu.Lock()
				if err != nil {
					res.Skipped = append(res.Skipped, SkippedFile{
						File: relTo(opt.Root, f), Reason: err.Error(),
					})
				} else {
					for _, h := range hits {
						if len(res.Hits) >= opt.MaxHits {
							res.Truncated = true
							break
						}
						res.Hits = append(res.Hits, h)
					}
				}
				mu.Unlock()
			}
		}()
	}
	for _, f := range files {
		if ctx.Err() != nil {
			break
		}
		mu.Lock()
		full := res.Truncated
		mu.Unlock()
		if full {
			break
		}
		jobs <- f
	}
	close(jobs)
	wg.Wait()

	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	res.Elapsed = time.Since(started).Milliseconds()
	return res, nil
}

// searchOne 搜一个库
func searchOne(ctx context.Context, path, root string, keywords []string, opt SearchOptions) ([]Hit, error) {
	db, err := Open(path)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	tables, err := db.Tables(ctx)
	if err != nil {
		return nil, err
	}
	rel := relTo(root, path)
	var out []Hit
	for _, t := range tables {
		if ctx.Err() != nil {
			return out, ctx.Err()
		}
		if len(t.Columns) == 0 {
			continue
		}
		hits, err := searchTable(ctx, db, rel, t, keywords, opt)
		if err != nil {
			// 一张表坏了不该让整个库的结果作废 —— 取证里这太常见了,
			// 而其余的表往往正是要找的
			continue
		}
		out = append(out, hits...)
	}
	return out, nil
}

func searchTable(ctx context.Context, db *DB, file string, t Table, keywords []string, opt SearchOptions) ([]Hit, error) {
	// 每一列 LIKE 每一个关键词,全部 OR 起来 —— 一张表一次查询
	var conds []string
	var args []any
	for _, col := range t.Columns {
		for _, kw := range keywords {
			// CAST 成 TEXT:不加的话 BLOB 列的 LIKE 结果依实现而异,
			// 而证据里大量的文本恰恰躺在 BLOB 列里
			conds = append(conds, fmt.Sprintf("CAST(%s AS TEXT) LIKE ? ESCAPE '\\'", quoteIdent(col)))
			args = append(args, "%"+escapeLike(kw)+"%")
		}
	}
	q := fmt.Sprintf("SELECT %s FROM %s WHERE %s LIMIT %d",
		selectList(t.Columns), quoteIdent(t.Name),
		strings.Join(conds, " OR "), opt.MaxHitsPerTable)

	rows, err := db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Hit
	for rows.Next() {
		cells, err := scanCells(rows, len(t.Columns))
		if err != nil {
			return nil, err
		}
		// SQL 只说了这一行有命中,没说命中在哪一列。自己再过一遍找出来 ——
		// 界面上要能直接指到那个格子,不然一行几十列还得人肉找
		col, kw := locate(t.Columns, cells, keywords, opt.CaseSensitive)
		out = append(out, Hit{
			File: file, Table: t.Name, Column: col, Keyword: kw,
			Columns: t.Columns, Row: cells,
		})
	}
	return out, rows.Err()
}

// locate 在一行里找出命中的是哪一列、哪个关键词
func locate(cols []string, cells []Cell, keywords []string, caseSensitive bool) (string, string) {
	for i, c := range cells {
		if c.Null {
			continue
		}
		hay := c.Text
		if !caseSensitive {
			hay = strings.ToLower(hay)
		}
		for _, kw := range keywords {
			needle := kw
			if !caseSensitive {
				needle = strings.ToLower(kw)
			}
			if strings.Contains(hay, needle) {
				return cols[i], kw
			}
		}
	}
	// 找不到不算错:文本被截断过,或者命中落在 BLOB 的摘要之外
	return "", ""
}

// escapeLike 把 LIKE 的通配符转义掉。
//
// 不转的话,搜一个带下划线的包名(com_tencent_mm)时,每个下划线都成了
// "任意一个字符",命中一大堆不相干的东西,而人完全想不到是为什么
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

func cleanKeywords(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, k := range in {
		k = strings.TrimSpace(k)
		if k == "" || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, k)
	}
	return out
}

// collectDBs 找出要搜的库。给的是文件就只搜它,是目录就整棵树翻一遍
func collectDBs(ctx context.Context, root string) ([]string, error) {
	st, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !st.IsDir() {
		if !IsSQLite(root) {
			return nil, fmt.Errorf("%s 不是 SQLite 库", filepath.Base(root))
		}
		return []string{root}, nil
	}

	var out []string
	err = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			// 单个目录读不了就跳过它,别让整次搜索失败
			return nil
		}
		if d.IsDir() {
			return nil
		}
		// -wal / -shm 是伴随文件,跟着主库一起处理,单独搜会重复
		name := d.Name()
		if strings.HasSuffix(name, "-wal") || strings.HasSuffix(name, "-shm") || strings.HasSuffix(name, "-journal") {
			return nil
		}
		info, err := d.Info()
		if err != nil || info.Size() < int64(len(Magic)) || info.Size() > maxFileSize {
			return nil
		}
		// 认文件头,不认扩展名 —— 安卓和 iOS 上大量的库根本没有扩展名
		if IsSQLite(p) {
			out = append(out, p)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func relTo(root, p string) string {
	if rel, err := filepath.Rel(root, p); err == nil {
		return filepath.ToSlash(rel)
	}
	return p
}

// toCell 把一个原始值转成能发给前端的单元格
func toCell(v any) Cell {
	switch x := v.(type) {
	case nil:
		return Cell{Null: true}
	case []byte:
		// BLOB 里也可能是正经文本(很多库把 JSON 存成 BLOB),
		// 是文本就当文本显示,不然人看到的全是十六进制
		if utf8.Valid(x) && !looksBinary(x) {
			return Cell{Text: truncate(string(x)), Blob: true, Size: len(x)}
		}
		return Cell{Text: hexPeek(x), Blob: true, Size: len(x)}
	case string:
		return Cell{Text: truncate(x)}
	case int64:
		return Cell{Text: strconv.FormatInt(x, 10)}
	case float64:
		return Cell{Text: strconv.FormatFloat(x, 'g', -1, 64)}
	case bool:
		return Cell{Text: strconv.FormatBool(x)}
	case time.Time:
		return Cell{Text: x.Format(time.RFC3339)}
	default:
		return Cell{Text: truncate(fmt.Sprint(x))}
	}
}

// looksBinary 有控制字符就当二进制。
// 单看 utf8.Valid 不够:一段随机字节相当容易碰巧是合法 UTF-8
func looksBinary(b []byte) bool {
	for _, c := range b {
		if c < 0x09 || (c > 0x0d && c < 0x20) {
			return true
		}
	}
	return false
}

func hexPeek(b []byte) string {
	n := len(b)
	if n > blobPeek {
		n = blobPeek
	}
	var sb strings.Builder
	sb.WriteString("0x")
	for _, c := range b[:n] {
		fmt.Fprintf(&sb, "%02X", c)
	}
	if len(b) > blobPeek {
		sb.WriteString("…")
	}
	return sb.String()
}

func truncate(s string) string {
	if len(s) <= maxCellText {
		return s
	}
	// 按 rune 截,别把一个多字节字符劈成两半
	r := []rune(s)
	if len(r) <= maxCellText {
		return s
	}
	return string(r[:maxCellText]) + "…"
}
