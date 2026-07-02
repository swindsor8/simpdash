package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"simpdash/internal/proxmox"
)

// Cached cluster extras: RRD trends, the cluster task log, and guest IPs.
// All are read-only PVE API data, memoized so browser refreshes and multiple
// tabs never multiply load on pvedaemon.

var rrdTimeframes = map[string]bool{"hour": true, "day": true, "week": true}

type rrdCache struct {
	mu      sync.Mutex
	entries map[string]rrdEntry
}

type rrdEntry struct {
	data    []proxmox.RRDPoint
	fetched time.Time
}

// RRD handles GET /api/rrd?node=X&timeframe=hour|day|week — node resource
// history straight from PVE's own RRD store (nothing persisted on our side).
func (s *Server) RRD(w http.ResponseWriter, r *http.Request) {
	node := r.URL.Query().Get("node")
	if !proxmox.ValidNodeName(node) {
		writeErr(w, http.StatusBadRequest, "invalid node")
		return
	}
	tf := r.URL.Query().Get("timeframe")
	if tf == "" {
		tf = "hour"
	}
	if !rrdTimeframes[tf] {
		writeErr(w, http.StatusBadRequest, "timeframe must be hour, day, or week")
		return
	}

	key := node + "|" + tf
	s.rrd.mu.Lock()
	if s.rrd.entries == nil {
		s.rrd.entries = map[string]rrdEntry{}
	}
	e, ok := s.rrd.entries[key]
	s.rrd.mu.Unlock()
	if ok && time.Since(e.fetched) < time.Minute {
		writeJSON(w, http.StatusOK, e.data)
		return
	}

	pts, err := s.px.FetchRRD(node, tf)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	s.rrd.mu.Lock()
	s.rrd.entries[key] = rrdEntry{data: pts, fetched: time.Now()}
	s.rrd.mu.Unlock()
	writeJSON(w, http.StatusOK, pts)
}

type tasksCache struct {
	mu      sync.Mutex
	data    []proxmox.ClusterTask
	fetched time.Time
}

// ClusterTasks handles GET /api/cluster-tasks — recent PVE tasks (migrations,
// backups, starts/stops…) cluster-wide, newest first, capped at 50.
func (s *Server) ClusterTasks(w http.ResponseWriter, r *http.Request) {
	s.tasks.mu.Lock()
	defer s.tasks.mu.Unlock()
	if time.Since(s.tasks.fetched) > 30*time.Second {
		tasks, err := s.px.FetchTasks()
		if err != nil {
			if s.tasks.data == nil {
				writeErr(w, http.StatusBadGateway, err.Error())
				return
			}
			// serve stale on transient PVE errors
		} else {
			if len(tasks) > 50 {
				tasks = tasks[:50]
			}
			s.tasks.data, s.tasks.fetched = tasks, time.Now()
		}
	}
	writeJSON(w, http.StatusOK, s.tasks.data)
}

type ipsCache struct {
	mu      sync.Mutex
	data    map[string][]string // "qemu:101" / "lxc:201" → IPs
	fetched time.Time
}

// GuestIPs handles GET /api/guest-ips — best-effort IPv4 addresses for every
// running local-cluster guest, keyed "qemu:<vmid>" / "lxc:<vmid>". Guests whose
// IPs can't be read (no QEMU agent, stopped, old PVE) are simply absent.
func (s *Server) GuestIPs(w http.ResponseWriter, r *http.Request) {
	s.ips.mu.Lock()
	defer s.ips.mu.Unlock()
	if s.ips.data != nil && time.Since(s.ips.fetched) < 2*time.Minute {
		writeJSON(w, http.StatusOK, s.ips.data)
		return
	}

	var snap proxmox.Snapshot
	if raw := s.poller.snapshot(); raw != nil {
		_ = json.Unmarshal(raw, &snap)
	}

	type target struct {
		node, gtype string
		vmid        int
	}
	var targets []target
	for _, n := range snap.Nodes {
		if n.Status != "online" {
			continue
		}
		for _, vm := range n.VMs {
			if vm.Status == "running" {
				targets = append(targets, target{n.ID, "qemu", vm.VMID})
			}
		}
		for _, ct := range n.LXCs {
			if ct.Status == "running" {
				targets = append(targets, target{n.ID, "lxc", ct.VMID})
			}
		}
	}

	out := map[string][]string{}
	var mu sync.Mutex
	sem := make(chan struct{}, 8) // bounded fan-out against pvedaemon
	var wg sync.WaitGroup
	for _, t := range targets {
		wg.Add(1)
		go func(t target) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			ips, err := s.px.GuestIPs(t.node, t.gtype, t.vmid)
			if err != nil || len(ips) == 0 {
				return // best-effort: no agent / old PVE / stopped mid-flight
			}
			mu.Lock()
			out[fmt.Sprintf("%s:%d", t.gtype, t.vmid)] = ips
			mu.Unlock()
		}(t)
	}
	wg.Wait()

	s.ips.data, s.ips.fetched = out, time.Now()
	writeJSON(w, http.StatusOK, out)
}
