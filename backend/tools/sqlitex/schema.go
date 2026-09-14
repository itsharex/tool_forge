package sqlitex

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// Table 一张表
type Table struct {
	Name string `json:"name"`
	// Columns 列名,按表里的顺序
	Columns []string `json:"columns"`
	// Rows 行数;-1 表示没数出来(表坏了)
	Rows int64 `json:"rows"`
	// Err 这张表有问题时说是什么问题。
	// 有问题的表不该让整个库打不开 —— 取证里坏掉几张表太常见了
	Err string `json:"err,omitempty"`
}

// Tables 列出库里所有的表。
//
// 只要 type='table':view 查起来可能触发任意表达式,index 和 trigger 不存数据。
// sqlite_ 开头的是内部表,对取证没有意义,排掉免得刷屏
func (d *DB) Tables(ctx context.Context) ([]Table, error) {
	rows, err := d.QueryContext(ctx,
		`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		return nil, err
	}
	var names []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			_ = rows.Close()
			return nil, err
		}
		names = append(names, n)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()

	out := make([]Table, 0, len(names))
	for _, name := range names {
		// Columns 先给空切片:这张表读不出列时它会一路空着走到 JSON,
		// nil 序列化出来是 null 而不是 [],前端按数组用就直接崩
		t := Table{Name: name, Rows: -1, Columns: []string{}}
		cols, err := d.columns(ctx, name)
		if err != nil {
			t.Err = err.Error()
			out = append(out, t)
			continue
		}
		t.Columns = cols
		// 行数是顺手给的,数不出来不算错 —— 页面坏了、加密了都可能数不出来,
		// 但表结构本身还是有价值的
		if n, err := d.countRows(ctx, name); err == nil {
			t.Rows = n
		}
		out = append(out, t)
	}
	return out, nil
}

func (d *DB) columns(ctx context.Context, table string) ([]string, error) {
	rows, err := d.QueryContext(ctx, fmt.Sprintf("PRAGMA table_info(%s)", quoteIdent(table)))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var (
			cid        int
			name, typ  string
			notnull    int
			dflt       sql.NullString
			primaryKey int
		)
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dflt, &primaryKey); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("没有列")
	}
	return out, nil
}

func (d *DB) countRows(ctx context.Context, table string) (int64, error) {
	var n int64
	err := d.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+quoteIdent(table)).Scan(&n)
	return n, err
}

// Page 一页数据
type Page struct {
	Columns []string `json:"columns"`
	// Rows 每行是一串单元格。值都转成了字符串,BLOB 会标出来
	Rows [][]Cell `json:"rows"`
	// Total 这张表一共多少行;-1 = 没数出来
	Total int64 `json:"total"`
	// Offset 这一页从第几行开始
	Offset int `json:"offset"`
}

// Cell 一个单元格
type Cell struct {
	// Text 显示用的文本。BLOB 给的是摘要,不是原始字节
	Text string `json:"text"`
	// Null 这个格子是 NULL —— 和空字符串是两回事,取证里这个区别有意义
	Null bool `json:"null,omitempty"`
	// Blob 这是个二进制列
	Blob bool `json:"blob,omitempty"`
	// Size BLOB 的字节数
	Size int `json:"size,omitempty"`
}

// Rows 翻一张表的数据。
//
// 不给 ORDER BY:证据库的表往往没有稳定主键,乱加排序反而让人以为
// 这就是原始顺序。SQLite 不带排序时给的是存储顺序,那才是更接近原貌的东西
func (d *DB) Rows(ctx context.Context, table string, offset, limit int) (*Page, error) {
	if limit <= 0 || limit > maxPageRows {
		limit = defaultPageRows
	}
	if offset < 0 {
		offset = 0
	}
	cols, err := d.columns(ctx, table)
	if err != nil {
		return nil, err
	}
	q := fmt.Sprintf("SELECT %s FROM %s LIMIT %d OFFSET %d",
		selectList(cols), quoteIdent(table), limit, offset)
	rows, err := d.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	page := &Page{Columns: cols, Rows: [][]Cell{}, Total: -1, Offset: offset}
	for rows.Next() {
		cells, err := scanCells(rows, len(cols))
		if err != nil {
			return nil, err
		}
		page.Rows = append(page.Rows, cells)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if n, err := d.countRows(ctx, table); err == nil {
		page.Total = n
	}
	return page, nil
}

func selectList(cols []string) string {
	out := make([]string, len(cols))
	for i, c := range cols {
		out[i] = quoteIdent(c)
	}
	return strings.Join(out, ", ")
}

// scanCells 把一行读成单元格。
//
// 全部扫进 any 再自己转:列的声明类型在 SQLite 里只是建议,
// 一个 TEXT 列里完全可以躺着整数和 BLOB,按声明类型扫会直接失败
func scanCells(rows *sql.Rows, n int) ([]Cell, error) {
	raw := make([]any, n)
	ptrs := make([]any, n)
	for i := range raw {
		ptrs[i] = &raw[i]
	}
	if err := rows.Scan(ptrs...); err != nil {
		return nil, err
	}
	out := make([]Cell, n)
	for i, v := range raw {
		out[i] = toCell(v)
	}
	return out, nil
}
