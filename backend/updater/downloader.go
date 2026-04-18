package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Download 把 manifest 里指向的 exe 流式下载到用户 Downloads 目录,
// 同步校验 sha256。期间通过 Wails 事件 "update:download-progress" 推送进度。
func Download(ctx context.Context, wailsCtx context.Context, m Manifest) (*DownloadResult, error) {
	downloadsDir, err := resolveDownloadsDir()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(downloadsDir, 0o755); err != nil {
		return nil, err
	}

	filename := fmt.Sprintf("%s%s.exe", DownloadPrefix, m.Version)
	localPath := filepath.Join(downloadsDir, filename)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.DownloadURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("下载失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
	}

	total := resp.ContentLength
	if total <= 0 {
		total = m.SizeBytes
	}

	f, err := os.OpenFile(localPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	h := sha256.New()
	pr := &progressReader{
		reader:   resp.Body,
		total:    total,
		wailsCtx: wailsCtx,
	}
	pr.emit(0) // 立刻派一次 0%,UI 第一时间显示进度条

	if _, err := io.Copy(io.MultiWriter(f, h), pr); err != nil {
		_ = os.Remove(localPath)
		return nil, fmt.Errorf("下载中断: %w", err)
	}

	got := hex.EncodeToString(h.Sum(nil))
	if !strings.EqualFold(got, m.SHA256) {
		_ = os.Remove(localPath)
		return nil, fmt.Errorf("sha256 校验失败: 期望 %s, 实际 %s", m.SHA256, got)
	}

	// 确保最后一次 100% 被发出(progressReader 可能在 98/99% 结束)
	pr.emit(pr.loaded)

	return &DownloadResult{
		LocalPath: localPath,
		Version:   m.Version,
		SHA256:    got,
		Size:      pr.loaded,
	}, nil
}

type progressReader struct {
	reader   io.Reader
	total    int64
	loaded   int64
	last     int
	wailsCtx context.Context
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.reader.Read(b)
	if n > 0 {
		p.loaded += int64(n)
		p.emit(p.loaded)
	}
	if err != nil && !errors.Is(err, io.EOF) {
		return n, err
	}
	return n, err
}

// emit 按百分比整数变化节流推送,避免事件洪水
func (p *progressReader) emit(loaded int64) {
	pct := 0
	if p.total > 0 {
		pct = int(loaded * 100 / p.total)
		if pct > 100 {
			pct = 100
		}
	}
	if pct == p.last && loaded != p.total {
		return
	}
	p.last = pct
	if p.wailsCtx != nil {
		wailsruntime.EventsEmit(p.wailsCtx, "update:download-progress", DownloadProgress{
			Loaded:  loaded,
			Total:   p.total,
			Percent: pct,
		})
	}
}

// resolveDownloadsDir 获取 Windows 下当前用户的 Downloads 目录。
// 走 %USERPROFILE%\Downloads,足够覆盖 99% 场景(OneDrive 重定向暂不处理)。
func resolveDownloadsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Downloads"), nil
}
