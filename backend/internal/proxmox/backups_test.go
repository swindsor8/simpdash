package proxmox

import "testing"

func TestNewestPerVMID(t *testing.T) {
	got := newestPerVMID([]rawContent{
		{VMID: 100, CTime: 1000, Size: 5},
		{VMID: 100, CTime: 3000, Size: 9}, // newer wins
		{VMID: 100, CTime: 2000, Size: 7},
		{VMID: 0, CTime: 9999},            // no vmid → dropped
		{VMID: 200, CTime: 500, Size: 3},
	})
	if got[100].CTime != 3000 || got[100].Size != 9 {
		t.Fatalf("vmid 100: want newest ctime 3000/size 9, got %+v", got[100])
	}
	if got[200].CTime != 500 {
		t.Fatalf("vmid 200: want 500, got %+v", got[200])
	}
	if _, ok := got[0]; ok {
		t.Fatal("vmid 0 should have been dropped")
	}
}

func TestBuildReport(t *testing.T) {
	snap := Snapshot{Nodes: []Node{{
		ID:   "pve",
		VMs:  []Guest{{VMID: 100, Name: "web", Status: "running"}},
		LXCs: []Guest{{VMID: 200, Name: "dns", Status: "running"}}, // no backup
	}}}
	latest := map[int]rawContent{100: {VMID: 100, CTime: 1700000000, Size: 42}}

	rep := buildReport(snap, latest, nil)
	if len(rep.Guests) != 2 {
		t.Fatalf("want 2 guests, got %d", len(rep.Guests))
	}
	byID := map[int]GuestBackup{}
	for _, g := range rep.Guests {
		byID[g.VMID] = g
	}
	if byID[100].LastBackup != 1700000000 || byID[100].Size != 42 || byID[100].Type != "qemu" {
		t.Fatalf("vmid 100: %+v", byID[100])
	}
	if byID[200].LastBackup != 0 || byID[200].Type != "lxc" {
		t.Fatalf("vmid 200 should have no backup: %+v", byID[200])
	}
	if rep.Jobs == nil {
		t.Fatal("Jobs should be non-nil (empty slice) for clean JSON")
	}
}
