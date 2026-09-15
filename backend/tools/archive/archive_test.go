package archive

import (
	"archive/tar"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// tar 包是从被取证的设备上拿来的,内容不可信。
// 包里可以写 ../../ 这样的成员名,不拦的话解包会把文件写到目标目录之外
func TestUntarRejectsPathTraversal(t *testing.T) {
	dir := t.TempDir()
	evil := filepath.Join(dir, "evil.tar")
	f, err := os.Create(evil)
	if err != nil {
		t.Fatal(err)
	}
	tw := tar.NewWriter(f)
	body := []byte("被写到外面去了")
	hdr := &tar.Header{
		Name:     "../../escaped.txt",
		Mode:     0o644,
		Size:     int64(len(body)),
		Typeflag: tar.TypeReg,
	}
	if err := tw.WriteHeader(hdr); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(body); err != nil {
		t.Fatal(err)
	}
	_ = tw.Close()
	_ = f.Close()

	dest := filepath.Join(dir, "out")
	if err := os.MkdirAll(dest, 0o755); err != nil {
		t.Fatal(err)
	}
	_, err = untarFile(evil, dest)
	if err == nil {
		t.Fatal("指向目录之外的成员应该被拒绝")
	}
	if !strings.Contains(err.Error(), "目标目录之外") {
		t.Errorf("报错该点明是路径越界,得到: %v", err)
	}
	// 确认真的没写出去
	if _, err := os.Stat(filepath.Join(dir, "..", "escaped.txt")); err == nil {
		t.Error("文件真的被写到目标目录之外了")
	}
}

// 正常的包要能解开,而且目录结构保持住

func TestUntarNormal(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "ok.tar")
	f, _ := os.Create(src)
	tw := tar.NewWriter(f)
	_ = tw.WriteHeader(&tar.Header{Name: "app", Mode: 0o755, Typeflag: tar.TypeDir})
	body := []byte("hello")
	_ = tw.WriteHeader(&tar.Header{
		Name: "app/shared_prefs/a.xml", Mode: 0o644,
		Size: int64(len(body)), Typeflag: tar.TypeReg,
	})
	_, _ = tw.Write(body)
	_ = tw.Close()
	_ = f.Close()

	dest := filepath.Join(dir, "out")
	res, err := untarFile(src, dest)
	if err != nil {
		t.Fatalf("正常的包应该解得开: %v", err)
	}
	if res.Files != 1 {
		t.Errorf("应该解出 1 个文件,得到 %d", res.Files)
	}
	// 那个 app/ 目录成员也要数上,不然 Files == 0 的包说不清是空目录还是空包
	if res.Dirs != 1 {
		t.Errorf("应该数到 1 个目录,得到 %d", res.Dirs)
	}
	got, err2 := os.ReadFile(filepath.Join(dest, "app", "shared_prefs", "a.xml"))
	if err2 != nil {
		t.Fatalf("解出来的文件不在: %v", err2)
	}
	if string(got) != "hello" {
		t.Errorf("内容不对: %q", got)
	}
}

// 安卓上合法的名字在 Windows 上未必合法 —— 微信就有个目录叫
// com.tencent.mm:appbrand0,冒号在 Windows 上是非法字符,mkdir 直接失败。
// 这条守的是"整包解包因为一个名字全废"那次真实失败
func TestSafeSegmentForWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("只在 Windows 上改名 —— 别的系统上冒号是合法的,在那儿改名等于把证据改坏了")
	}
	cases := map[string]string{
		"com.tencent.mm:appbrand0": "com.tencent.mm_appbrand0",
		"normal_name":              "normal_name",
		"a<b>c":                    "a_b_c",
		"trailing.":                "trailing",
		"trailing ":                "trailing",
		"con":                      "con_",
		"CON.txt":                  "CON.txt_",
		"aux":                      "aux_",
		"":                         "",
	}
	for in, want := range cases {
		if got := SafeSegment(in); got != want {
			t.Errorf("SafeSegment(%q) = %q,想要 %q", in, got, want)
		}
	}
	p, changed := LocalSafePath("app/com.tencent.mm:appbrand0/x.txt")
	if !changed || p != "app/com.tencent.mm_appbrand0/x.txt" {
		t.Errorf("整条路径没改对: %q changed=%v", p, changed)
	}
	// 正常路径一个字节都不该动
	if p2, changed2 := LocalSafePath("app/ok/x.txt"); changed2 || p2 != "app/ok/x.txt" {
		t.Errorf("正常路径不该动: %q changed=%v", p2, changed2)
	}
}

// 改了名必须能被上报出去 —— 取证里文件名本身就是证据的一部分,
// 悄悄换掉而不吭声是在给后面的人埋雷

func TestUntarReportsRenames(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("只在 Windows 上会改名")
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "r.tar")
	f, _ := os.Create(src)
	tw := tar.NewWriter(f)
	body := []byte("x")
	_ = tw.WriteHeader(&tar.Header{
		Name: "app/com.tencent.mm:appbrand0/a.txt", Mode: 0o644,
		Size: int64(len(body)), Typeflag: tar.TypeReg,
	})
	_, _ = tw.Write(body)
	_ = tw.Close()
	_ = f.Close()

	dest := filepath.Join(dir, "out")
	res, err := untarFile(src, dest)
	if err != nil {
		t.Fatalf("带冒号的名字应该改名后解开,而不是整包失败: %v", err)
	}
	if res.Files != 1 {
		t.Errorf("应该解出 1 个文件,得到 %d", res.Files)
	}
	if res.Renamed != 1 {
		t.Errorf("应该报告 1 处改名,得到 %d", res.Renamed)
	}
	if len(res.Samples) == 0 || !strings.Contains(res.Samples[0], "appbrand0") {
		t.Errorf("改名记录里应该看得出改的是哪个: %v", res.Samples)
	}
	if _, err := os.Stat(filepath.Join(dest, "app", "com.tencent.mm_appbrand0", "a.txt")); err != nil {
		t.Errorf("改名后的文件不在: %v", err)
	}
}

// 去重的边界:比的是路径分段而不是字符串前缀。
// /sdcard/Download 和 /sdcard/Downloads 前缀上是包含关系,位置上却毫无关系 ——
// 按前缀比会把后一个整个当成前一个的子目录漏掉

// 流式解包的关键一条:传到一半断了,必须报错,不能拿着半个包当成功。
//
// 安卓那条路现在是 adb 一边拉、untarFrom 一边解,中间靠 io.Pipe 连着。
// 拉取失败时那头调 CloseWithError,读的这头必须把错误带出来 ——
// 不然一次断掉的传输会安安静静地变成"导出成功",而目录里只有前半截文件。
// 取证里这比直接失败糟得多:没人会去核对一份"成功"的导出。
func TestStreamedUntarFailsOnTruncatedStream(t *testing.T) {
	// 先造一个正常的包,拿到它的完整字节
	dir := t.TempDir()
	src := filepath.Join(dir, "full.tar")
	f, _ := os.Create(src)
	tw := tar.NewWriter(f)
	body := make([]byte, 8192)
	for i := range body {
		body[i] = byte(i)
	}
	for _, name := range []string{"app/a.bin", "app/b.bin", "app/c.bin"} {
		_ = tw.WriteHeader(&tar.Header{
			Name: name, Mode: 0o644, Size: int64(len(body)), Typeflag: tar.TypeReg,
		})
		_, _ = tw.Write(body)
	}
	_ = tw.Close()
	_ = f.Close()
	whole, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}

	// 拉到一半断掉,和 adb 中途失败时一模一样
	pr, pw := io.Pipe()
	go func() {
		_, _ = pw.Write(whole[:len(whole)/3])
		pw.CloseWithError(errors.New("设备掉线了"))
	}()
	dest := filepath.Join(dir, "out")
	_, err = Untar(pr, dest)
	_ = pr.Close()
	if err == nil {
		t.Fatal("传了一半就断,却报告成功 —— 这样一次失败的导出会被当成完整的")
	}
	if !strings.Contains(err.Error(), "掉线") {
		t.Errorf("该把底层的原因带出来,得到: %v", err)
	}
}

// 完整的流要能正常解开,而且内容一个字节不差 ——
// 上面那条只证明"断了会报错",不证明"没断时是对的"

func TestStreamedUntarRoundTrip(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "full.tar")
	f, _ := os.Create(src)
	tw := tar.NewWriter(f)
	want := []byte("一段会被原样解出来的内容")
	_ = tw.WriteHeader(&tar.Header{
		Name: "app/data.bin", Mode: 0o644, Size: int64(len(want)), Typeflag: tar.TypeReg,
	})
	_, _ = tw.Write(want)
	_ = tw.Close()
	_ = f.Close()
	whole, _ := os.ReadFile(src)

	pr, pw := io.Pipe()
	go func() {
		_, _ = pw.Write(whole)
		pw.CloseWithError(nil)
	}()
	dest := filepath.Join(dir, "out")
	res, err := Untar(pr, dest)
	_ = pr.Close()
	if err != nil {
		t.Fatal(err)
	}
	if res.Files != 1 {
		t.Fatalf("该解出 1 个文件,得到 %d", res.Files)
	}
	got, err := os.ReadFile(filepath.Join(dest, "app", "data.bin"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Errorf("内容对不上: %q", got)
	}
	// 本地不该留下任何 tar —— 流式那条路的全部意义就在这儿
	tars, _ := filepath.Glob(filepath.Join(dest, "*.tar"))
	if len(tars) > 0 {
		t.Errorf("输出目录里留下了 tar: %v", tars)
	}
}

// untarFile 把一个 tar 文件解开。生产代码上只有流式的 untarFrom,
// 但测试里从磁盘上造一个包再解要方便得多

// untarFile 从磁盘上的 tar 解包。生产代码只有流式的 Untar,
// 但测试里造一个包再解要方便得多
func untarFile(tarPath, dest string) (Result, error) {
	f, err := os.Open(tarPath)
	if err != nil {
		return Result{}, err
	}
	defer f.Close()
	return Untar(f, dest)
}
