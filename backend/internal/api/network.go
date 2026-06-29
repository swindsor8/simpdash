package api

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"simpdash/internal/proxmox"
)

// IfaceView is a Proxmox interface enriched with host link details from sysfs.
type IfaceView struct {
	proxmox.NetworkIface
	SpeedMbps int    `json:"speed_mbps,omitempty"` // physical NICs only; -1/0 if unknown
	MTU       int    `json:"mtu,omitempty"`
	MAC       string `json:"mac,omitempty"`
	OperState string `json:"operstate,omitempty"`
	Carrier   *bool  `json:"carrier,omitempty"` // nil when the file is absent
}

// Network handles GET /api/network — the PVE host's interfaces plus link details.
func (s *Server) Network(w http.ResponseWriter, r *http.Request) {
	ifaces, err := s.px.FetchNetwork(s.selfNode)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	views := make([]IfaceView, 0, len(ifaces))
	for _, ifc := range ifaces {
		sp, mtu, mac, op, car := readLink(ifc.Iface)
		views = append(views, IfaceView{
			NetworkIface: ifc, SpeedMbps: sp, MTU: mtu, MAC: mac, OperState: op, Carrier: car,
		})
	}
	writeJSON(w, http.StatusOK, views)
}

// readLink pulls link details from /sys/class/net/<iface>/. Virtual or down
// interfaces don't expose "speed", so reads are best-effort.
func readLink(iface string) (speed, mtu int, mac, operstate string, carrier *bool) {
	base := "/sys/class/net/" + iface + "/"
	if b, err := os.ReadFile(base + "speed"); err == nil {
		if v, e := strconv.Atoi(strings.TrimSpace(string(b))); e == nil {
			speed = v
		}
	}
	if b, err := os.ReadFile(base + "mtu"); err == nil {
		if v, e := strconv.Atoi(strings.TrimSpace(string(b))); e == nil {
			mtu = v
		}
	}
	if b, err := os.ReadFile(base + "address"); err == nil {
		mac = strings.TrimSpace(string(b))
	}
	if b, err := os.ReadFile(base + "operstate"); err == nil {
		operstate = strings.TrimSpace(string(b))
	}
	if b, err := os.ReadFile(base + "carrier"); err == nil {
		up := strings.TrimSpace(string(b)) == "1"
		carrier = &up
	}
	return
}

// IfaceStats is one interface's counters from /proc/net/dev.
type IfaceStats struct {
	RxBytes   uint64 `json:"rx_bytes"`
	TxBytes   uint64 `json:"tx_bytes"`
	RxPackets uint64 `json:"rx_packets"`
	TxPackets uint64 `json:"tx_packets"`
	RxErrs    uint64 `json:"rx_errs"`
	TxErrs    uint64 `json:"tx_errs"`
	RxDrop    uint64 `json:"rx_drop"`
	TxDrop    uint64 `json:"tx_drop"`
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
	f, err := os.Open("/proc/net/dev")
	if err != nil {
		return map[string]IfaceStats{}
	}
	defer f.Close()
	return parseNetDev(f)
}

// parseNetDev does the parsing, split out so the column indices are testable.
func parseNetDev(r io.Reader) map[string]IfaceStats {
	out := map[string]IfaceStats{}
	sc := bufio.NewScanner(r)
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
		if len(fields) < 16 { // 8 rx + 8 tx columns
			continue
		}
		parse := func(s string) uint64 { v, _ := strconv.ParseUint(s, 10, 64); return v }
		// /proc/net/dev columns: rx bytes packets errs drop ... (8) tx bytes packets errs drop
		out[iface] = IfaceStats{
			RxBytes:   parse(fields[0]),
			RxPackets: parse(fields[1]),
			RxErrs:    parse(fields[2]),
			RxDrop:    parse(fields[3]),
			TxBytes:   parse(fields[8]),
			TxPackets: parse(fields[9]),
			TxErrs:    parse(fields[10]),
			TxDrop:    parse(fields[11]),
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
	s.appendSpeedtestHistory(STHistoryEntry{
		TS: time.Now().Unix(), Download: result.Download, Upload: result.Upload, Ping: result.Ping,
	})
	writeJSON(w, http.StatusOK, result)
}

// STHistoryEntry is one stored speed-test result.
type STHistoryEntry struct {
	TS       int64   `json:"ts"`
	Download float64 `json:"download"`
	Upload   float64 `json:"upload"`
	Ping     float64 `json:"ping"`
}

var stHistMu sync.Mutex

func (s *Server) speedtestHistPath() string {
	return filepath.Join(filepath.Dir(s.cfg.DBPath), "speedtest_history.json")
}

func (s *Server) readSpeedtestHistory() []STHistoryEntry {
	stHistMu.Lock()
	defer stHistMu.Unlock()
	var h []STHistoryEntry
	if data, err := os.ReadFile(s.speedtestHistPath()); err == nil {
		json.Unmarshal(data, &h)
	}
	return h
}

// appendSpeedtestHistory records a result, keeping the most recent 50.
func (s *Server) appendSpeedtestHistory(e STHistoryEntry) {
	stHistMu.Lock()
	defer stHistMu.Unlock()
	var h []STHistoryEntry
	if data, err := os.ReadFile(s.speedtestHistPath()); err == nil {
		json.Unmarshal(data, &h)
	}
	h = append(h, e)
	if len(h) > 50 {
		h = h[len(h)-50:]
	}
	if data, err := json.MarshalIndent(h, "", " "); err == nil {
		os.WriteFile(s.speedtestHistPath(), data, 0o644)
	}
}

// SpeedtestHistory handles GET /api/network/speedtest/history.
func (s *Server) SpeedtestHistory(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.readSpeedtestHistory())
}

// Connectivity is a snapshot of WAN/DNS/gateway reachability.
type Connectivity struct {
	WANIP      string   `json:"wan_ip,omitempty"`
	DNS        []string `json:"dns"`
	Gateway    string   `json:"gateway,omitempty"`
	GatewayUp  bool     `json:"gateway_up"`
	InternetUp bool     `json:"internet_up"`
}

// Connectivity handles GET /api/network/connectivity. Each probe is best-effort
// with a short timeout so one slow check can't stall the response.
func (s *Server) Connectivity(w http.ResponseWriter, r *http.Request) {
	c := Connectivity{DNS: readResolvConf(), Gateway: defaultGateway()}
	// A TCP handshake to a public resolver is a quick, privilege-free "is the
	// internet up" check (more reliable than ICMP from a container).
	if conn, err := net.DialTimeout("tcp", "1.1.1.1:53", 2*time.Second); err == nil {
		conn.Close()
		c.InternetUp = true
	}
	if c.Gateway != "" {
		c.GatewayUp = pingHost(c.Gateway)
	}
	c.WANIP = fetchWANIP()
	writeJSON(w, http.StatusOK, c)
}

// readResolvConf returns the nameservers from /etc/resolv.conf.
func readResolvConf() []string {
	out := []string{}
	f, err := os.Open("/etc/resolv.conf")
	if err != nil {
		return out
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) >= 2 && fields[0] == "nameserver" {
			out = append(out, fields[1])
		}
	}
	return out
}

// defaultGateway parses `ip route show default` → the gateway IP.
func defaultGateway() string {
	out, err := exec.Command("ip", "route", "show", "default").Output()
	if err != nil {
		return ""
	}
	fields := strings.Fields(string(out)) // "default via 10.0.0.1 dev vmbr0 ..."
	for i, f := range fields {
		if f == "via" && i+1 < len(fields) {
			return fields[i+1]
		}
	}
	return ""
}

func pingHost(host string) bool {
	return exec.Command("ping", "-c", "1", "-W", "1", host).Run() == nil
}

// fetchWANIP returns the public IP via an external lookup (best-effort, 3s).
func fetchWANIP() string {
	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("https://api.ipify.org")
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 64))
	return strings.TrimSpace(string(b))
}
