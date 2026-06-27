package api

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// Network handles GET /api/network — returns the PVE host's network interfaces.
func (s *Server) Network(w http.ResponseWriter, r *http.Request) {
	ifaces, err := s.px.FetchNetwork(s.selfNode)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ifaces)
}

// IfaceStats is one interface's counters from /proc/net/dev.
type IfaceStats struct {
	RxBytes   uint64 `json:"rx_bytes"`
	TxBytes   uint64 `json:"tx_bytes"`
	RxPackets uint64 `json:"rx_packets"`
	TxPackets uint64 `json:"tx_packets"`
}

// GuestNet is one VM/CT's cumulative network counters (from cluster/resources).
type GuestNet struct {
	VMID   int    `json:"vmid"`
	Name   string `json:"name"`
	Type   string `json:"type"` // "qemu" | "lxc"
	Status string `json:"status"`
	NetIn  int64  `json:"netin"`
	NetOut int64  `json:"netout"`
}

// NetworkStats handles GET /api/network/stats — cumulative byte counters for
// both the host's interfaces (/proc/net/dev) and every guest (cluster/resources).
// The frontend polls every 2 s and computes rates itself by diffing.
func (s *Server) NetworkStats(w http.ResponseWriter, r *http.Request) {
	resp := struct {
		Ifaces map[string]IfaceStats `json:"ifaces"`
		Guests []GuestNet            `json:"guests"`
	}{
		Ifaces: readProcNetDev(),
		Guests: []GuestNet{},
	}

	// Guest counters are best-effort: if Proxmox is unreachable the host
	// interface table still works.
	if snap, err := s.px.Fetch(); err == nil {
		for _, n := range snap.Nodes {
			for _, g := range n.VMs {
				resp.Guests = append(resp.Guests, GuestNet{g.VMID, g.Name, "qemu", g.Status, g.NetIn, g.NetOut})
			}
			for _, g := range n.LXCs {
				resp.Guests = append(resp.Guests, GuestNet{g.VMID, g.Name, "lxc", g.Status, g.NetIn, g.NetOut})
			}
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// readProcNetDev parses /proc/net/dev into per-interface counters.
func readProcNetDev() map[string]IfaceStats {
	out := map[string]IfaceStats{}
	f, err := os.Open("/proc/net/dev")
	if err != nil {
		return out
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for i := 0; sc.Scan(); i++ {
		if i < 2 { // skip two header lines
			continue
		}
		line := strings.TrimSpace(sc.Text())
		colon := strings.Index(line, ":")
		if colon < 0 {
			continue
		}
		iface := strings.TrimSpace(line[:colon])
		fields := strings.Fields(line[colon+1:])
		if len(fields) < 9 {
			continue
		}
		parse := func(s string) uint64 { v, _ := strconv.ParseUint(s, 10, 64); return v }
		out[iface] = IfaceStats{
			RxBytes:   parse(fields[0]),
			TxBytes:   parse(fields[8]),
			RxPackets: parse(fields[1]),
			TxPackets: parse(fields[9]),
		}
	}
	return out
}

// SpeedtestResult is the subset of speedtest-cli --json output we care about.
type SpeedtestResult struct {
	Download float64 `json:"download"` // bits/s
	Upload   float64 `json:"upload"`   // bits/s
	Ping     float64 `json:"ping"`     // ms
	Server   struct {
		Sponsor string `json:"sponsor"`
		Name    string `json:"name"`
		Country string `json:"country"`
	} `json:"server"`
}

// Speedtest handles POST /api/network/speedtest — runs speedtest-cli and
// returns parsed results. Takes ~15-30 s; client should show a loading state.
func (s *Server) Speedtest(w http.ResponseWriter, r *http.Request) {
	out, err := exec.Command("speedtest-cli", "--json", "--secure").Output()
	if err != nil {
		// surface install hint if binary is missing
		if strings.Contains(err.Error(), "executable file not found") || strings.Contains(err.Error(), "no such file") {
			writeErr(w, http.StatusNotFound, "speedtest-cli not installed — run: apt install -y speedtest-cli")
			return
		}
		writeErr(w, http.StatusBadGateway, execErr(err))
		return
	}
	var result SpeedtestResult
	if err := json.Unmarshal(out, &result); err != nil {
		writeErr(w, http.StatusBadGateway, "could not parse speedtest output")
		return
	}
	writeJSON(w, http.StatusOK, result)
}
