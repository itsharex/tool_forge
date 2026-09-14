// Package sqlitex 读取取证导出里的 SQLite 库:按关键词搜、按表浏览。
//
// 这个包最要紧的一条是**不动原始文件**。打开一个 SQLite 库并不是只读操作:
// 库旁边有 -wal / -journal 时,SQLite 会在打开时回放或回滚,把它们合进主库 ——
// 也就是说"打开看一眼"就已经改了证据,而且改完还看不出来。
// 所以这里从来不直接打开原文件,见 Open 的说明。
package sqlitex

import (
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite" // 纯 Go 实现,不需要 CGO,也就不需要用户装编译器
)

// Magic SQLite 文件头。认文件靠它,不靠扩展名 ——
// 安卓和 iOS 上的库叫 .db / .sqlite / .sqlite3 / .store,也有大量根本没有扩展名的
const Magic = "SQLite format 3\x00"

// sidecars 主库旁边可能有的伴随文件。
// 复制时必须一起带走:-wal 里存的是还没合进主库的最新写入,
// 少拿它就等于丢掉最近那一批数据 —— 聊天记录取证里,最新的往往最要紧
var sidecars = []string{"-wal", "-shm", "-journal"}

// DB 一个打开的库。用完必须 Close,不然临时副本会留在磁盘上
type DB struct {
	*sql.DB
	// tempDir 复制出来的那份放哪儿;没复制就是空
	tempDir string
	// Path 原始文件路径
	Path string
	// Copied 这次是不是走了复制。界面上要说清楚 ——
	// 复制过说明原库带着未合并的 WAL,读到的内容比原文件本身多
	Copied bool
}

func (d *DB) Close() error {
	err := d.DB.Close()
	if d.tempDir != "" {
		// 副本必须删掉:证据库动辄几百 MB,留着就是往用户盘里堆垃圾
		_ = os.RemoveAll(d.tempDir)
	}
	return err
}

// Open 打开一个库,保证不动原始文件。
//
// 两条路,按旁边有没有 -wal / -journal 分:
//
//   - 没有:直接以 immutable 只读打开。SQLite 承诺一个字节都不写,
//     几百 MB 的库也是零拷贝,最快。
//   - 有:先把主库连同伴随文件复制到临时目录,再打开副本。
//     这样 SQLite 尽管去回放 WAL —— 它改的是副本。
//     不这么做只有两个选择,都不能接受:要么让它改原文件(毁证据),
//     要么用 immutable 忽略 WAL(漏掉最新那批数据,而且不会有任何提示)。
func Open(path string) (*DB, error) {
	if err := checkMagic(path); err != nil {
		return nil, err
	}
	extras := existingSidecars(path)
	if len(extras) == 0 {
		db, err := sql.Open("sqlite", dsn(path, true))
		if err != nil {
			return nil, err
		}
		if err := db.Ping(); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("打不开 %s: %w", filepath.Base(path), err)
		}
		return &DB{DB: db, Path: path}, nil
	}

	tmp, err := os.MkdirTemp("", "toolforge-db-")
	if err != nil {
		return nil, err
	}
	local := filepath.Join(tmp, filepath.Base(path))
	if err := copyFile(path, local); err != nil {
		_ = os.RemoveAll(tmp)
		return nil, err
	}
	for _, suffix := range extras {
		// 伴随文件名必须是"主库名 + 后缀",SQLite 就是按这个找的
		if err := copyFile(path+suffix, local+suffix); err != nil {
			_ = os.RemoveAll(tmp)
			return nil, err
		}
	}
	// 副本要让 SQLite 能写(回放 WAL 需要),所以这里不加 immutable
	db, err := sql.Open("sqlite", dsn(local, false))
	if err != nil {
		_ = os.RemoveAll(tmp)
		return nil, err
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		_ = os.RemoveAll(tmp)
		return nil, fmt.Errorf("打不开 %s: %w", filepath.Base(path), err)
	}
	return &DB{DB: db, tempDir: tmp, Path: path, Copied: true}, nil
}

// dsn 拼连接串。
//
// immutable=1 是"我保证这个文件不会变,你也别想写它" —— 省掉加锁和 shm,
// 只读打开一个证据文件正合适。但它同时意味着忽略 WAL,所以只在确认
// 旁边没有 WAL 时才用
func dsn(path string, immutable bool) string {
	// URI 里的反斜杠要换成正斜杠,不然 Windows 路径会被当成转义
	u := "file:" + filepath.ToSlash(path) + "?mode=ro"
	if immutable {
		u += "&immutable=1"
	}
	return u
}

// checkMagic 先看文件头。
// 不先看的话,一个随便什么文件也能被 sql.Open 接受(它是懒打开的),
// 等到查询时才报一个看不懂的错
func checkMagic(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	head := make([]byte, len(Magic))
	n, err := io.ReadFull(f, head)
	if err != nil && n < len(Magic) {
		return fmt.Errorf("%s 太小,不是 SQLite 库", filepath.Base(path))
	}
	if string(head) != Magic {
		return fmt.Errorf("%s 不是 SQLite 库(文件头对不上)", filepath.Base(path))
	}
	return nil
}

// IsSQLite 快速判断一个文件是不是 SQLite 库。遍历目录时用
func IsSQLite(path string) bool {
	return checkMagic(path) == nil
}

func existingSidecars(path string) []string {
	var out []string
	for _, suffix := range sidecars {
		if st, err := os.Stat(path + suffix); err == nil && !st.IsDir() && st.Size() > 0 {
			out = append(out, suffix)
		}
	}
	return out
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

// quoteIdent 把表名/列名包成 SQLite 的标识符。
//
// 这些名字是从库里读出来的,不是我们写死的 —— 真实的库里出现过带空格、
// 带引号、带关键字的表名。不包起来的话轻则语法错误,重则拼出别的语句
func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}
