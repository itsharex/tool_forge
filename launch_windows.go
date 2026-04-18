//go:build windows

package main

import "syscall"

// detachedSysProcAttr 返回让子进程脱离本进程控制台的 SysProcAttr。
// DETACHED_PROCESS(0x8)保证我们 Quit 后子进程继续存活。
func detachedSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		CreationFlags: 0x00000008,
	}
}
