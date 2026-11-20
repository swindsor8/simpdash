// Package hardware collects host hardware health telemetry: Linux thermal/fan
// sensors from sysfs, SMART drive status from smartctl, and ZFS pool health
// from zpool. Every probe degrades cleanly when tools or hardware access are
// absent (e.g. inside an LXC container or on a host without ZFS).
package hardware

import (
	"context"
	"sync"
	"time"
)

// Report is the full hardware health snapshot returned by GET /api/hardware.
type Report struct {
	CollectedAt int64         `json:"collected_at"`
	Sensors     []SensorGroup `json:"sensors"`
	Drives      []DriveHealth `json:"drives"`
	ZFSPools    []ZFSPool     `json:"zfs_pools"`
	SmartNote   string        `json:"smart_note,omitempty"`
	ZFSNote     string        `json:"zfs_note,omitempty"`
}

// Collector gathers hardware telemetry, caching the heavier subprocess probes
// (SMART + ZFS) while always reading sysfs thermal/fan sensors fresh.
type Collector struct {
	sysRoot string

	mu          sync.Mutex
	cachedAt    time.Time
	drives      []DriveHealth
	zfsPools    []ZFSPool
	smartNote   string
	zfsNote     string
	cacheTTL    time.Duration
}

// NewCollector creates a hardware collector reading sysfs from /sys.
func NewCollector() *Collector {
	return &Collector{
		sysRoot:  "/sys",
		cacheTTL: 60 * time.Second,
	}
}

// Collect gathers sensors (always live) and SMART/ZFS (cached for cacheTTL
// unless forceRefresh is true).
func (c *Collector) Collect(ctx context.Context, forceRefresh bool) Report {
	sensors := ReadSensors(c.sysRoot)

	c.mu.Lock()
	needSlow := forceRefresh || c.cachedAt.IsZero() || time.Since(c.cachedAt) > c.cacheTTL
	drives := c.drives
	zfsPools := c.zfsPools
	smartNote := c.smartNote
	zfsNote := c.zfsNote
	c.mu.Unlock()

	if needSlow {
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			drives, smartNote = CollectDrives(ctx)
		}()
		go func() {
			defer wg.Done()
			zfsPools, zfsNote = CollectZFS(ctx)
		}()
		wg.Wait()

		c.mu.Lock()
		c.drives = drives
		c.zfsPools = zfsPools
		c.smartNote = smartNote
		c.zfsNote = zfsNote
		c.cachedAt = time.Now()
		c.mu.Unlock()
	}

	if sensors == nil {
		sensors = []SensorGroup{}
	}
	if drives == nil {
		drives = []DriveHealth{}
	}
	if zfsPools == nil {
		zfsPools = []ZFSPool{}
	}
	return Report{
		CollectedAt: time.Now().Unix(),
		Sensors:     sensors,
		Drives:      drives,
		ZFSPools:    zfsPools,
		SmartNote:   smartNote,
		ZFSNote:     zfsNote,
	}
}
