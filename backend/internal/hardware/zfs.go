package hardware

import (
	"context"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// ZFSVdev represents one line in a `zpool status` config tree.
type ZFSVdev struct {
	Name   string `json:"name"`
	State  string `json:"state"`
	Read   int64  `json:"read"`
	Write  int64  `json:"write"`
	Cksum  int64  `json:"cksum"`
	Indent int    `json:"indent"`
}

// ZFSPool summarizes one ZFS storage pool's capacity, health, and vdev tree.
type ZFSPool struct {
	Name    string    `json:"name"`
	Health  string    `json:"health"`
	Size    int64     `json:"size"`
	Alloc   int64     `json:"alloc"`
	Free    int64     `json:"free"`
	CapPct  int       `json:"cap_pct"`
	FragPct int       `json:"frag_pct"`
	Scan    string    `json:"scan,omitempty"`
	Errors  string    `json:"errors,omitempty"`
	Vdevs   []ZFSVdev `json:"vdevs,omitempty"`
}

// CollectZFS queries `zpool list` and `zpool status` on the local host.
// Degrades cleanly when ZFS is not installed or no pools are imported.
func CollectZFS(ctx context.Context) ([]ZFSPool, string) {
	zctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	listOut, err := exec.CommandContext(zctx, "zpool", "list", "-H", "-p", "-o", "name,size,alloc,free,cap,frag,health").Output()
	if err != nil {
		if strings.Contains(err.Error(), "executable file not found") || strings.Contains(err.Error(), "no such file") {
			return []ZFSPool{}, "ZFS tools (zpool) not installed on this host"
		}
		return []ZFSPool{}, ""
	}
	pools := ParseZpoolList(string(listOut))
	if len(pools) == 0 {
		return []ZFSPool{}, ""
	}

	if statusOut, err := exec.CommandContext(zctx, "zpool", "status").Output(); err == nil {
		stMap := ParseZpoolStatus(string(statusOut))
		for i := range pools {
			if st, ok := stMap[pools[i].Name]; ok {
				pools[i].Scan = st.scan
				pools[i].Errors = st.errors
				pools[i].Vdevs = st.vdevs
			}
		}
	}
	return pools, ""
}

// ParseZpoolList parses `zpool list -H -p -o name,size,alloc,free,cap,frag,health`.
func ParseZpoolList(raw string) []ZFSPool {
	out := []ZFSPool{}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		f := strings.Split(line, "\t")
		if len(f) < 7 {
			f = strings.Fields(line)
		}
		if len(f) < 7 {
			continue
		}
		out = append(out, ZFSPool{
			Name:    f[0],
			Size:    parseInt64(f[1]),
			Alloc:   parseInt64(f[2]),
			Free:    parseInt64(f[3]),
			CapPct:  parsePct(f[4]),
			FragPct: parsePct(f[5]),
			Health:  f[6],
		})
	}
	return out
}

type zpoolStatusInfo struct {
	scan   string
	errors string
	vdevs  []ZFSVdev
}

// ParseZpoolStatus extracts scan, errors, and vdev rows per pool from `zpool status`.
func ParseZpoolStatus(raw string) map[string]zpoolStatusInfo {
	out := map[string]zpoolStatusInfo{}
	var curName string
	var cur zpoolStatusInfo
	section := ""

	flush := func() {
		if curName != "" {
			cur.scan = strings.TrimSpace(cur.scan)
			cur.errors = strings.TrimSpace(cur.errors)
			out[curName] = cur
		}
	}

	for _, line := range strings.Split(raw, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "pool:") {
			flush()
			curName = strings.TrimSpace(strings.TrimPrefix(trimmed, "pool:"))
			cur = zpoolStatusInfo{}
			section = ""
			continue
		}
		if curName == "" {
			continue
		}
		switch {
		case strings.HasPrefix(trimmed, "state:"):
			section = "state"
		case strings.HasPrefix(trimmed, "status:"):
			section = "status"
		case strings.HasPrefix(trimmed, "action:"):
			section = "action"
		case strings.HasPrefix(trimmed, "scan:"):
			section = "scan"
			cur.scan = strings.TrimSpace(strings.TrimPrefix(trimmed, "scan:"))
		case strings.HasPrefix(trimmed, "config:"):
			section = "config"
		case strings.HasPrefix(trimmed, "errors:"):
			section = "errors"
			cur.errors = strings.TrimSpace(strings.TrimPrefix(trimmed, "errors:"))
		default:
			if trimmed == "" {
				continue
			}
			switch section {
			case "scan":
				if cur.scan != "" {
					cur.scan += " " + trimmed
				} else {
					cur.scan = trimmed
				}
			case "config":
				if strings.HasPrefix(trimmed, "NAME") {
					continue
				}
				// Measure leading indentation (tabs count as 8, spaces as 1)
				lead := 0
				for _, ch := range line {
					if ch == '\t' {
						lead += 8
					} else if ch == ' ' {
						lead++
					} else {
						break
					}
				}
				fields := strings.Fields(trimmed)
				if len(fields) == 0 {
					continue
				}
				v := ZFSVdev{Name: fields[0], Indent: lead}
				if len(fields) >= 2 {
					v.State = fields[1]
				}
				if len(fields) >= 5 {
					v.Read = parseInt64(fields[2])
					v.Write = parseInt64(fields[3])
					v.Cksum = parseInt64(fields[4])
				}
				cur.vdevs = append(cur.vdevs, v)
			}
		}
	}
	flush()

	// Normalize vdev indentation to levels 0, 1, 2...
	for name, info := range out {
		if len(info.vdevs) == 0 {
			continue
		}
		minIndent := info.vdevs[0].Indent
		for _, v := range info.vdevs {
			if v.Indent < minIndent {
				minIndent = v.Indent
			}
		}
		for i := range info.vdevs {
			diff := info.vdevs[i].Indent - minIndent
			info.vdevs[i].Indent = diff / 2
		}
		out[name] = info
	}
	return out
}

func parseInt64(s string) int64 {
	s = strings.TrimSpace(s)
	if s == "" || s == "-" {
		return 0
	}
	v, _ := strconv.ParseInt(s, 10, 64)
	return v
}

func parsePct(s string) int {
	s = strings.TrimSuffix(strings.TrimSpace(s), "%")
	if s == "" || s == "-" {
		return 0
	}
	v, _ := strconv.Atoi(s)
	return v
}
