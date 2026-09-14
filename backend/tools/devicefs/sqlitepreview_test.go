package devicefs

import (
	"os"
	"strings"
	"testing"

	"tool_forge/backend/tools/sqlitex"
)

// 预览一个 SQLite 必须整个拉,还要带上 -wal。插着 iOS 设备时才跑,平时自动跳过。
//
// 这条守的是两个真实缺陷:
//
//  1. 预览默认按上限截着拉(iOS 8MB)。别的类型看个开头就够,SQLite 却不行 ——
//     截断的库就是损坏的库,打开直接报错。实测设备上 Photos.sqlite 有 17.9MB,
//     是上限的两倍多。
//  2. 只拉主库会漏掉 -wal 里还没并进去的写入。iOS 上短信、通讯录、通话记录
//     每一个旁边都有 -wal。
func TestSQLitePreviewPullsWholeFileAndWAL(t *testing.T) {
	m := NewManager()
	s, err := m.Connect(ConnectOptions{Platform: "ios", Password: iosTestPassword()})
	if err != nil {
		t.Skip("没有可连的 iOS 设备:", err)
	}
	defer m.CloseAll()

	// 挑一个库,优先挑超过预览上限的 —— 那种最能说明问题
	var remote string
	var size int64
	for _, cand := range []string{
		"/private/var/mobile/Media/PhotoData/Photos.sqlite",
		"/private/var/mobile/Library/SMS/sms.db",
		"/private/var/mobile/Library/AddressBook/AddressBook.sqlitedb",
	} {
		st, err := m.Stat(s.ID, cand)
		if err != nil {
			continue
		}
		remote, size = cand, st.Size
		if size > iosPreviewLimit {
			break
		}
	}
	if remote == "" {
		t.Skip("这台设备上没找到常见的系统库")
	}

	cache := t.TempDir()
	p, err := m.Preview(s.ID, remote, cache)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%s: 设备上 %d 字节, note=%q", remote, size, p.Note)

	local, err := os.Stat(p.LocalPath)
	if err != nil {
		t.Fatal(err)
	}
	if local.Size() != size {
		t.Errorf("库没拉全(本地 %d / 设备 %d)—— 截断的 SQLite 打不开", local.Size(), size)
	}
	if p.Truncated {
		t.Error("库不该被标成截断")
	}

	// 设备上有 -wal 的话,本地也得有,而且要说出来
	if s.t.exists(remote + "-wal") {
		if _, err := os.Stat(p.LocalPath + "-wal"); err != nil {
			t.Errorf("设备上有 -wal 但没拉下来,最近写入的数据会看不到: %v", err)
		}
		if !strings.Contains(p.Note, "-wal") {
			t.Errorf("带了 -wal 就该说出来,不然看到的内容多了一部分而人不知道: %q", p.Note)
		}
	}

	// 表浏览器走的就是这条
	db, err := sqlitex.Open(p.LocalPath)
	if err != nil {
		t.Fatalf("表浏览器打不开拉下来的这份: %v", err)
	}
	defer db.Close()
	tables, err := db.Tables(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(tables) == 0 {
		t.Error("一张表都没读出来")
	}
	t.Logf("%d 张表, copied=%v", len(tables), db.Copied)
}

// iosTestPassword 越狱设备的 SSH 密码。
//
// 从环境变量取,取不到就用越狱设备的出厂默认值 ——
// 别把某台具体设备的密码写进仓库
func iosTestPassword() string {
	if v := os.Getenv("TOOLFORGE_IOS_SSH_PASSWORD"); v != "" {
		return v
	}
	return "alpine"
}
