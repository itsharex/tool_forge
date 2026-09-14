package sqlitex

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// makeDB 造一个库。
//
// wal 为真时造出"主库 + 未合并的 WAL"这一对 —— 这正是导出时拿到的样子:
// 应用还在跑,最近写的那批还留在 WAL 里没并回主库。
// 做法是趁着写入端还没关闭就把两个文件复制出来,不然 SQLite 关闭时
// 会自动合并,WAL 就没了,也就测不到要测的东西
func makeDB(t *testing.T, dir, name string, wal bool) string {
	t.Helper()
	work := filepath.Join(dir, "_work")
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(work, name)
	p := filepath.Join(dir, name)
	db, err := sql.Open("sqlite", src)
	if err != nil {
		t.Fatal(err)
	}
	if wal {
		if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
			t.Fatal(err)
		}
		// 别自动合并,不然写着写着 WAL 就空了
		if _, err := db.Exec("PRAGMA wal_autocheckpoint=0"); err != nil {
			t.Fatal(err)
		}
	}
	stmts := []string{
		`CREATE TABLE messages (id INTEGER PRIMARY KEY, sender TEXT, content TEXT, payload BLOB)`,
		`INSERT INTO messages VALUES (1, '张三', '明天在老地方见', NULL)`,
		`INSERT INTO messages VALUES (2, '李四', 'hello world', NULL)`,
		`INSERT INTO messages VALUES (3, '王五', NULL, X'00010203FFFE')`,
		// 表名和列名里带引号、空格、关键词 —— 真实的库里都出现过
		`CREATE TABLE "odd ""table" ("select" TEXT)`,
		`INSERT INTO "odd ""table" VALUES ('明天见')`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
	// 趁没关就复制 —— 关了 WAL 就被合并掉了
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if _, err := os.Stat(src + suffix); err != nil {
			continue
		}
		if err := copyFile(src+suffix, p+suffix); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	// 工作目录要清掉:它就在 dir 下面,留着的话整棵树里会多出一份一模一样的库,
	// 按目录搜时命中数直接翻倍
	if err := os.RemoveAll(work); err != nil {
		t.Fatal(err)
	}
	return p
}

func sum(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		return "(不存在)"
	}
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// 这是整个包最重要的一条:读证据不能改证据。
//
// 打开一个带 -wal 的 SQLite 库,SQLite 默认会把 WAL 回放进主库 ——
// 也就是"看一眼"就把两个文件都改了,而且改完毫无痕迹。
// 取证里这是致命的:哈希对不上,整份证据的效力就没了。
func TestOpenNeverTouchesTheOriginal(t *testing.T) {
	dir := t.TempDir()
	p := makeDB(t, dir, "evidence.db", true)
	if st, err := os.Stat(p + "-wal"); err != nil || st.Size() == 0 {
		t.Fatalf("前提不成立:没造出未合并的 WAL: %v", err)
	}

	before := map[string]string{}
	for _, f := range []string{p, p + "-wal", p + "-shm"} {
		before[f] = sum(t, f)
	}

	db, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	if !db.Copied {
		t.Error("旁边有 WAL 时必须走复制,不能直接开原文件")
	}
	// 认真读一遍,把 SQLite 该干的事都逼出来
	tables, err := db.Tables(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(tables) != 2 {
		t.Errorf("应该有 2 张表,得到 %d", len(tables))
	}
	tmp := db.tempDir
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	for f, want := range before {
		if got := sum(t, f); got != want {
			t.Errorf("%s 被改动了!\n  之前 %s\n  之后 %s", filepath.Base(f), want, got)
		}
	}
	// 副本不能留在磁盘上 —— 证据库动辄几百 MB
	if _, err := os.Stat(tmp); !os.IsNotExist(err) {
		t.Errorf("临时副本没删掉: %s", tmp)
	}
}

// 没有 WAL 时不该白白复制一份:几百 MB 的库复制一遍要好几秒
func TestNoWalMeansNoCopy(t *testing.T) {
	dir := t.TempDir()
	p := makeDB(t, dir, "plain.db", false)
	_ = os.Remove(p + "-wal")
	_ = os.Remove(p + "-shm")

	db, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if db.Copied {
		t.Error("没有伴随文件时不该复制")
	}
}

// WAL 里的数据必须搜得到。
//
// 走 immutable 打开能保证不改原文件,但它会忽略 WAL ——
// 而 WAL 里装的恰恰是最近写入的那批,聊天记录取证里最要紧的那部分。
// 复制那条路存在的全部理由就是这个。
func TestSearchSeesDataStillInWAL(t *testing.T) {
	dir := t.TempDir()
	work := filepath.Join(dir, "_work")
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(work, "wal.db")
	p := filepath.Join(dir, "wal.db")
	db, err := sql.Open("sqlite", src)
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, db, "PRAGMA journal_mode=WAL")
	mustExec(t, db, "PRAGMA wal_autocheckpoint=0")
	mustExec(t, db, `CREATE TABLE t (v TEXT)`)
	mustExec(t, db, `INSERT INTO t VALUES ('只在WAL里的秘密')`)
	// 趁写入端还开着就复制走:这时候数据还在 WAL 里,没并回主库
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if _, err := os.Stat(src + suffix); err != nil {
			continue
		}
		if err := copyFile(src+suffix, p+suffix); err != nil {
			t.Fatal(err)
		}
	}
	_ = db.Close()
	if err := os.RemoveAll(work); err != nil {
		t.Fatal(err)
	}

	if st, err := os.Stat(p + "-wal"); err != nil || st.Size() == 0 {
		t.Fatal("前提不成立:没造出未合并的 WAL")
	}
	// 先反证一次:把主库单独拎出来(不带 WAL)应该一条都搜不到。
	// 没有这一步的话,万一数据其实已经在主库里,这条用例会碰巧通过,
	// 而它本来要守的东西一点没守住
	alone := filepath.Join(dir, "alone.db")
	if err := copyFile(p, alone); err != nil {
		t.Fatal(err)
	}
	if res, err := Search(context.Background(), SearchOptions{Root: alone, Keywords: []string{"秘密"}}); err != nil {
		t.Fatal(err)
	} else if len(res.Hits) != 0 {
		t.Fatal("前提不成立:数据已经在主库里了,这条用例测不到 WAL")
	}

	res, err := Search(context.Background(), SearchOptions{Root: p, Keywords: []string{"秘密"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Hits) != 1 {
		t.Fatalf("WAL 里的数据没搜到(命中 %d 条)", len(res.Hits))
	}
}

// 搜索要返回命中的那一行内容,不是只说"这张表有"
func TestSearchReturnsTheRow(t *testing.T) {
	dir := t.TempDir()
	makeDB(t, dir, "a.db", false)

	res, err := Search(context.Background(), SearchOptions{Root: dir, Keywords: []string{"明天"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Hits) != 2 {
		t.Fatalf("「明天」在两张表里各有一条,得到 %d", len(res.Hits))
	}
	var found bool
	for _, h := range res.Hits {
		if h.Table != "messages" {
			continue
		}
		found = true
		if h.Column != "content" {
			t.Errorf("命中的列该是 content,得到 %q", h.Column)
		}
		// 整行都要在:光知道哪一列命中没用,要看得到是谁发的
		if len(h.Row) != 4 {
			t.Fatalf("应该带回整行 4 个格子,得到 %d", len(h.Row))
		}
		if h.Row[1].Text != "张三" {
			t.Errorf("同一行的其它列没带回来: %+v", h.Row)
		}
		if h.Row[3].Text != "" && !h.Row[3].Null {
			t.Errorf("NULL 该标成 Null: %+v", h.Row[3])
		}
	}
	if !found {
		t.Error("messages 表里那条没找到")
	}
}

// 表名列名里带引号、空格、SQL 关键词的库是真实存在的,不能拼崩
func TestOddIdentifiers(t *testing.T) {
	dir := t.TempDir()
	makeDB(t, dir, "odd.db", false)

	res, err := Search(context.Background(), SearchOptions{Root: dir, Keywords: []string{"明天见"}})
	if err != nil {
		t.Fatal(err)
	}
	var hit bool
	for _, h := range res.Hits {
		if strings.Contains(h.Table, "odd") {
			hit = true
		}
	}
	if !hit {
		t.Error(`表名叫 odd "table、列名叫 select 的表没搜到`)
	}
}

// 关键词里的下划线和百分号是字面量,不是通配符。
//
// 不转义的话,搜 com_tencent_mm 时每个下划线都成了"任意一个字符",
// 会命中一堆不相干的东西,而人完全想不到是为什么
func TestKeywordWildcardsAreLiteral(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "w.db")
	db, _ := sql.Open("sqlite", p)
	mustExec(t, db, `CREATE TABLE t (v TEXT)`)
	mustExec(t, db, `INSERT INTO t VALUES ('com_tencent_mm')`)
	mustExec(t, db, `INSERT INTO t VALUES ('comXtencentXmm')`)
	mustExec(t, db, `INSERT INTO t VALUES ('100%正品')`)
	mustExec(t, db, `INSERT INTO t VALUES ('100块正品')`)
	_ = db.Close()

	res, err := Search(context.Background(), SearchOptions{Root: p, Keywords: []string{"com_tencent_mm"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Hits) != 1 {
		t.Errorf("下划线该当字面量,只该命中 1 条,得到 %d", len(res.Hits))
	}
	res, err = Search(context.Background(), SearchOptions{Root: p, Keywords: []string{"100%正品"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Hits) != 1 {
		t.Errorf("百分号该当字面量,只该命中 1 条,得到 %d", len(res.Hits))
	}
}

// 认文件头而不是扩展名 —— 安卓和 iOS 上大量的库根本没有扩展名
func TestFindsDBsWithoutExtension(t *testing.T) {
	dir := t.TempDir()
	makeDB(t, dir, "no_extension_at_all", false)
	// 扔一个叫 .db 但根本不是库的文件进去
	if err := os.WriteFile(filepath.Join(dir, "fake.db"), []byte("这不是数据库"), 0o644); err != nil {
		t.Fatal(err)
	}
	files, err := collectDBs(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range files {
		names = append(names, filepath.Base(f))
	}
	if len(files) != 1 || filepath.Base(files[0]) != "no_extension_at_all" {
		t.Errorf("该按文件头认,得到: %v", names)
	}
}

// 坏掉一个库不该让整次搜索失败,但必须报出来是哪个、为什么
func TestBrokenDBIsReportedNotFatal(t *testing.T) {
	dir := t.TempDir()
	makeDB(t, dir, "good.db", false)
	// 一个有正确文件头、内容是垃圾的"库"
	bad := filepath.Join(dir, "broken.db")
	if err := os.WriteFile(bad, append([]byte(Magic), make([]byte, 200)...), 0o644); err != nil {
		t.Fatal(err)
	}

	res, err := Search(context.Background(), SearchOptions{Root: dir, Keywords: []string{"明天"}})
	if err != nil {
		t.Fatalf("一个坏库不该让整次搜索失败: %v", err)
	}
	if len(res.Hits) == 0 {
		t.Error("好的那个库还是该搜出来")
	}
	if len(res.Skipped) != 1 || !strings.Contains(res.Skipped[0].File, "broken") {
		t.Errorf("坏掉的库要如实报出来,得到: %+v", res.Skipped)
	}
}

// 空结果必须是空数组而不是 null —— 前端把它当数组用
func TestEmptyResultsAreNotNil(t *testing.T) {
	dir := t.TempDir()
	makeDB(t, dir, "a.db", false)
	res, err := Search(context.Background(), SearchOptions{Root: dir, Keywords: []string{"绝不会出现的词"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Hits == nil || res.Skipped == nil {
		t.Errorf("空结果要是空数组: hits=%v skipped=%v", res.Hits, res.Skipped)
	}
}

func TestBrowseRows(t *testing.T) {
	dir := t.TempDir()
	p := makeDB(t, dir, "b.db", false)
	db, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	page, err := db.Rows(context.Background(), "messages", 1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 3 {
		t.Errorf("总行数该是 3,得到 %d", page.Total)
	}
	if len(page.Rows) != 2 {
		t.Errorf("从第 1 行开始该剩 2 行,得到 %d", len(page.Rows))
	}
	// BLOB 要标出来,而且不能把原始字节直接塞进文本
	last := page.Rows[len(page.Rows)-1]
	if !last[3].Blob || last[3].Size != 6 {
		t.Errorf("BLOB 列没标对: %+v", last[3])
	}
	if !strings.HasPrefix(last[3].Text, "0x") {
		t.Errorf("二进制 BLOB 该给十六进制摘要: %q", last[3].Text)
	}
}

func mustExec(t *testing.T, db *sql.DB, q string) {
	t.Helper()
	if _, err := db.Exec(q); err != nil {
		t.Fatal(fmt.Errorf("%s: %w", q, err))
	}
}
