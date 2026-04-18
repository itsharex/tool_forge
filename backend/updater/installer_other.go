//go:build !windows

package updater

// 非 Windows 平台:暂无自搬家能力;HandleStartup 空实现,保持可编译。
func HandleStartup() {}
