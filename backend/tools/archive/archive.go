// Package archive 解 tar 包。
//
// 单独成包是因为两处要用:移动取证按应用目录整包导出,真机浏览按文件夹导出。
// 而这里的两道处理都是被真实数据逼出来的,复制一份出去迟早有一边会漏掉:
// tar 成员可能指向目标目录之外,以及安卓/iOS 上合法的文件名在 Windows 上未必合法。
package archive

import (
	"archive/tar"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Result 一次解包的统计
type Result struct {
	Files int
	// Dirs 目录成员数。它存在是为了让 Files == 0 说得清:
	// 「只有几个空目录」和「解包把东西吞了」在只报文件数的日志里长得一模一样,
	// 而取证报告里"这个目录我们没提到东西"是个要站得住的结论
	Dirs    int
	Renamed int
	Skipped int
	// samples 前几条改名记录,写进日志给人看
	Samples []string
}

// maxRenameSamples 日志里最多举几个改名的例子。
// 微信那种目录一改就是几百个,全打出来只会把日志淹掉
const maxRenameSamples = 3

// untar 解开一个 tar 到 dest。
//
// 两件事必须做,都是被真实数据逼出来的:
//
//  1. 逐条校验路径落在 dest 里面。tar 包里可以写 ../../ 这样的成员名,
//     不拦的话解包会把文件写到目标目录之外。这个包是从被取证的设备上拿来的,
//     内容不可信,这道检查不能省。
//
//  2. 安卓上合法的名字在 Windows 上未必合法。微信就有个目录叫
//     com.tencent.mm:appbrand0 —— 冒号在 Windows 上是非法字符,
//     mkdir 直接失败,而原来的写法会让整包解包中断,前面拉下来的全丢。
//     现在改成替换非法字符并计数上报:数据留住,改动如实说出来。
//
// Untar 从一个流里解包。两个平台都走它,边收边解,本地不落 tar。
//
// iOS 那边 tar 直接从设备的 ssh 通道流过来,设备上也不落文件;
// 安卓那边 adb 的同步协议要一个现成的文件才能拉,所以设备上那一份躲不掉,
// 但本地这一份可以省 —— 几百 MB 的应用少一读一写,
// 而且进程被杀时不会在证据目录里留下半个 .tar
func Untar(r io.Reader, dest string) (Result, error) {
	var res Result
	absDest, err := filepath.Abs(dest)
	if err != nil {
		return res, err
	}
	if err := os.MkdirAll(absDest, 0o755); err != nil {
		return res, err
	}
	tr := tar.NewReader(r)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return res, nil
		}
		if err != nil {
			return res, err
		}

		cleaned, renamed := LocalSafePath(hdr.Name)
		target := filepath.Join(absDest, filepath.FromSlash(cleaned))
		absTarget, err := filepath.Abs(target)
		if err != nil {
			return res, err
		}
		if !strings.HasPrefix(absTarget, absDest+string(os.PathSeparator)) && absTarget != absDest {
			return res, fmt.Errorf("包里有指向目标目录之外的成员: %s", hdr.Name)
		}
		if renamed {
			res.Renamed++
			if len(res.Samples) < maxRenameSamples {
				res.Samples = append(res.Samples, hdr.Name+" → "+cleaned)
			}
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			res.Dirs++
			if err := os.MkdirAll(absTarget, 0o755); err != nil {
				return res, err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(absTarget), 0o755); err != nil {
				return res, err
			}
			out, err := os.Create(absTarget)
			if err != nil {
				return res, err
			}
			// tar 是流式读的,再大的成员也不会整个进内存
			if _, err := io.Copy(out, tr); err != nil {
				_ = out.Close()
				return res, err
			}
			if err := out.Close(); err != nil {
				return res, err
			}
			res.Files++
		default:
			// 软链、设备节点之类跳过:落到本地文件系统上没有意义,
			// 而软链还可能指到目标目录之外
			res.Skipped++
		}
	}
}

// windowsIllegal Windows 文件名里不能出现的字符。
// 安卓那边这些全是合法的 —— 冒号尤其常见,应用的多进程目录就叫 <包名>:<进程名>
const windowsIllegal = `<>:"|?*`

// windowsReserved Windows 上不能当文件名的保留字(不分大小写,带扩展名也不行)
var windowsReserved = map[string]bool{
	"con": true, "prn": true, "aux": true, "nul": true,
	"com1": true, "com2": true, "com3": true, "com4": true, "com5": true,
	"com6": true, "com7": true, "com8": true, "com9": true,
	"lpt1": true, "lpt2": true, "lpt3": true, "lpt4": true, "lpt5": true,
	"lpt6": true, "lpt7": true, "lpt8": true, "lpt9": true,
}

// LocalSafePath 把 tar 里的成员名改成本地文件系统能接受的。
//
// 只在 Windows 上真的改。Linux / macOS 上冒号之类都是合法的,
// 在那儿改名反而是把原始证据改坏了。
func LocalSafePath(name string) (string, bool) {
	if runtime.GOOS != "windows" {
		return name, false
	}
	parts := strings.Split(name, "/")
	changed := false
	for i, seg := range parts {
		fixed := SafeSegment(seg)
		if fixed != seg {
			changed = true
			parts[i] = fixed
		}
	}
	return strings.Join(parts, "/"), changed
}

func SafeSegment(seg string) string {
	if seg == "" || seg == "." || seg == ".." {
		return seg
	}
	var b strings.Builder
	for _, r := range seg {
		if r < 0x20 || strings.ContainsRune(windowsIllegal, r) {
			b.WriteByte('_')
			continue
		}
		b.WriteRune(r)
	}
	out := b.String()
	// 结尾的点和空格 Windows 会自己吞掉,留着会造成两个不同的名字撞在一起
	out = strings.TrimRight(out, ". ")
	if out == "" {
		return "_"
	}
	// 保留字要加个后缀躲开;带扩展名的也算(con.txt 同样开不了)
	base := strings.ToLower(out)
	if i := strings.IndexByte(base, '.'); i >= 0 {
		base = base[:i]
	}
	if windowsReserved[base] {
		out += "_"
	}
	return out
}

// Describe 把统计写成一句人话。
//
// 文件数为 0 时特意点明「只有 N 个空目录」——那种情况下 "extracted 0 file(s)"
// 看着像出了事,而它多半只是个本来就空的 media 目录。反过来,真的一个成员都
// 没有时也说清楚,这才是该起疑的情况。
func Describe(r Result) string {
	switch {
	case r.Files > 0:
		return fmt.Sprintf("extracted %d file(s)", r.Files)
	case r.Dirs > 0:
		return fmt.Sprintf("extracted 0 file(s) —— 包里只有 %d 个空目录,没有文件", r.Dirs)
	default:
		return "extracted 0 file(s) —— 包里一个成员都没有"
	}
}
