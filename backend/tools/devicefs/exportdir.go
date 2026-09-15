package devicefs

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"tool_forge/backend/tools/adbx"
	"tool_forge/backend/tools/archive"
)

// 按文件夹导出。
//
// 一个一个文件拉是不行的:一个应用目录几千个小文件,每个都是一次协议往返,
// USB 上慢到没法用。所以两个平台都先在设备上 tar 成一条流,边收边解。
//
// 导出结果保留设备上的完整路径(data/user/0/<包名>/... 这样),和「移动取证」一致 ——
// 只存最后一层的话,从不同位置导出的同名目录会解到一起相互覆盖,
// 而且事后看不出哪个文件原来在哪。

const (
	// dirExportTimeout 打包一个目录的上限。
	// 整个应用目录几百 MB 是常事,给足
	dirExportTimeout = 15 * time.Minute
)

// ExportDirResult 一次文件夹导出的结果
type ExportDirResult struct {
	// Remote 设备上的源路径
	Remote string `json:"remote"`
	// LocalDir 落到本地哪个目录(输出根目录,里面按设备原路径展开)
	LocalDir string `json:"localDir"`
	// RootPath 解出来的顶层路径,给"打开目录"用
	RootPath string `json:"rootPath"`
	Files    int    `json:"files"`
	Bytes    int64  `json:"bytes"`
	// Renamed Windows 上被改掉的非法文件名数量。
	// 取证里文件名本身就是证据,改了必须让人看见
	Renamed int `json:"renamed"`
	// RenameSamples 改名的例子
	RenameSamples []string `json:"renameSamples"`
	// Skipped 跳过的成员(软链、设备节点)
	Skipped int `json:"skipped"`
	// ElapsedMs 耗时
	ElapsedMs int64 `json:"elapsedMs"`
}

// ExportDir 把设备上一个目录整个拉到本地
func (m *Manager) ExportDir(sessionID, remote, localDir string) (*ExportDirResult, error) {
	s, err := m.get(sessionID)
	if err != nil {
		return nil, err
	}
	remote = cleanRemote(remote)
	if remote == "" || remote == "/" {
		return nil, fmt.Errorf("不能导出根目录")
	}
	st, err := s.t.stat(remote)
	if err != nil {
		return nil, err
	}
	if !st.IsDir {
		return nil, fmt.Errorf("%s 不是目录 —— 单个文件用「导出」就行", remote)
	}
	if strings.TrimSpace(localDir) == "" {
		return nil, fmt.Errorf("没给本地目录")
	}
	if err := os.MkdirAll(localDir, 0o755); err != nil {
		return nil, err
	}

	started := time.Now()
	rel := strings.TrimPrefix(remote, "/")
	res := &ExportDirResult{
		Remote: remote, LocalDir: localDir,
		RootPath:      filepath.Join(localDir, filepath.FromSlash(rel)),
		RenameSamples: []string{},
	}

	var stat archive.Result
	var n int64
	switch t := s.t.(type) {
	case *androidTransport:
		stat, n, err = t.exportDir(remote, localDir)
	case *iosTransport:
		stat, n, err = t.exportDir(remote, localDir)
	default:
		return nil, fmt.Errorf("这个平台还不支持按文件夹导出")
	}
	if err != nil {
		return nil, err
	}

	res.Files = stat.Files
	res.Bytes = n
	res.Renamed = stat.Renamed
	res.Skipped = stat.Skipped
	if stat.Samples != nil {
		res.RenameSamples = stat.Samples
	}
	res.ElapsedMs = time.Since(started).Milliseconds()
	return res, nil
}

// exportDir 安卓:设备上打包成文件 → 边拉边解。
//
// 设备上那份临时包躲不掉 —— adb 的同步协议要一个现成的文件才能拉。
// 拉完就删,但这一点得说在明处:取证场景里往被取证的设备写东西不是小事
func (t *androidTransport) exportDir(remote, localDir string) (archive.Result, int64, error) {
	var zero archive.Result
	rel := strings.TrimPrefix(remote, "/")
	stage := fmt.Sprintf("/sdcard/.toolforge-browse-%d.tar", time.Now().UnixNano())

	script := fmt.Sprintf("tar -cf %s -C / %s && chmod 666 %s",
		adbx.Quote(stage), adbx.Quote(rel), adbx.Quote(stage))
	if _, err := adbx.Text(t.dev, script, t.root, dirExportTimeout); err != nil {
		return zero, 0, fmt.Errorf("在设备上打包失败: %w", err)
	}
	defer func() {
		_, _ = adbx.Text(t.dev, "rm -f "+adbx.Quote(stage), t.root, androidCmdTimeout)
	}()

	pr, pw := io.Pipe()
	go func() {
		// 拉取出错要交给读的那头:传不完时必须报错,不能拿着半个包当成功
		pw.CloseWithError(t.dev.Pull(stage, pw))
	}()
	counted := &countingReader{r: pr}
	res, err := archive.Untar(counted, localDir)
	_ = pr.Close()
	if err != nil {
		return zero, 0, fmt.Errorf("拉取/解包失败: %w", err)
	}
	return res, counted.n, nil
}

// exportDir iOS:tar 直接从 ssh 的 stdout 流回来,设备上一个字节都不写
func (t *iosTransport) exportDir(remote, localDir string) (archive.Result, int64, error) {
	var zero archive.Result
	rel := strings.TrimPrefix(remote, "/")

	sess, err := t.ssh.NewSession()
	if err != nil {
		return zero, 0, err
	}
	defer sess.Close()
	stdout, err := sess.StdoutPipe()
	if err != nil {
		return zero, 0, err
	}
	// --ignore-failed-read:总有几个文件读不了(被占用、权限特殊),
	// 没有它 tar 会因为其中一个直接失败,整个目录一个字节都拿不到
	cmd := fmt.Sprintf("tar --ignore-failed-read -cf - -C / %s", shellQuote(rel))
	if err := sess.Start(cmd); err != nil {
		return zero, 0, err
	}
	counted := &countingReader{r: stdout}
	res, err := archive.Untar(counted, localDir)
	if err != nil {
		return zero, 0, fmt.Errorf("解包失败: %w", err)
	}
	// tar 的退出码要收:忽略的话,一个中途失败的打包会被当成正常结束,
	// 拿到半个目录还以为是全的
	if werr := sess.Wait(); werr != nil {
		return res, counted.n, fmt.Errorf("设备上的 tar 没有正常结束(%w)—— 这一份可能不完整", werr)
	}
	return res, counted.n, nil
}

// countingReader 数一下流过来多少字节
type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}
