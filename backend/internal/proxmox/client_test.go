package proxmox

import (
	"encoding/json"
	"testing"
)

// Sample mirrors a real GET /cluster/resources payload: one node with one VM
// and one LXC, plus a storage entry that must be ignored.
const sample = `[
  {"type":"node","node":"pve1","status":"online","cpu":0.12,"maxcpu":8,"mem":8800000000,"maxmem":34000000000,"disk":340000000000,"maxdisk":512000000000,"uptime":1209600},
  {"type":"qemu","node":"pve1","vmid":101,"name":"jellyfin","status":"running","cpu":0.04,"mem":2100000000,"maxmem":4000000000,"disk":0,"maxdisk":0,"uptime":86000},
  {"type":"lxc","node":"pve1","vmid":201,"name":"pihole","status":"running","cpu":0.01,"mem":180000000,"maxmem":512000000,"disk":900000000,"maxdisk":4000000000,"uptime":86400},
  {"type":"storage","node":"pve1","name":"local","status":"available","disk":1,"maxdisk":2}
]`

func TestReshape(t *testing.T) {
	var raw []rawResource
	if err := json.Unmarshal([]byte(sample), &raw); err != nil {
		t.Fatal(err)
	}
	snap := reshape(raw)

	if len(snap.Nodes) != 1 {
		t.Fatalf("want 1 node, got %d (storage must be dropped)", len(snap.Nodes))
	}
	n := snap.Nodes[0]
	if n.ID != "pve1" || !n.Managed || n.MaxCPU != 8 {
		t.Fatalf("node fields wrong: %+v", n)
	}
	if len(n.VMs) != 1 || len(n.LXCs) != 1 {
		t.Fatalf("want 1 vm + 1 lxc, got %d/%d", len(n.VMs), len(n.LXCs))
	}

	// VM disk must serialize as JSON null; LXC disk as a number.
	out, _ := json.Marshal(snap)
	var rt struct {
		Nodes []struct {
			VMs  []map[string]json.RawMessage `json:"vms"`
			LXCs []map[string]json.RawMessage `json:"lxcs"`
		} `json:"nodes"`
	}
	json.Unmarshal(out, &rt)
	if string(rt.Nodes[0].VMs[0]["disk"]) != "null" {
		t.Errorf("VM disk should be null, got %s", rt.Nodes[0].VMs[0]["disk"])
	}
	if _, ok := rt.Nodes[0].VMs[0]["maxdisk"]; ok {
		t.Errorf("VM should have no maxdisk key (omitempty)")
	}
	if string(rt.Nodes[0].LXCs[0]["disk"]) != "900000000" {
		t.Errorf("LXC disk wrong: %s", rt.Nodes[0].LXCs[0]["disk"])
	}
	if string(rt.Nodes[0].LXCs[0]["maxdisk"]) != "4000000000" {
		t.Errorf("LXC maxdisk wrong: %s", rt.Nodes[0].LXCs[0]["maxdisk"])
	}
}
