package proxmox

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
)

// GuestBackup is one VM/CT's backup status: when it was last backed up (newest
// backup file's creation time, 0 if none found) and that file's size.
type GuestBackup struct {
	VMID       int    `json:"vmid"`
	Name       string `json:"name"`
	Type       string `json:"type"` // "qemu" | "lxc"
	Node       string `json:"node"`
	Status     string `json:"status"` // guest run state, for context
	LastBackup int64  `json:"last_backup"`
	Size       int64  `json:"size"`
}

// BackupJob is one vzdump task result from a node's task log. PVE reports backup
// success per job (not per guest), so this is where pass/fail actually lives.
type BackupJob struct {
	Node      string `json:"node"`
	UPID      string `json:"upid"`
	Status    string `json:"status"` // "OK", an error string, or "" while running
	StartTime int64  `json:"starttime"`
	EndTime   int64  `json:"endtime"`
}

// BackupReport is the full per-guest + per-job backup picture for the cluster.
type BackupReport struct {
	Guests []GuestBackup `json:"guests"`
	Jobs   []BackupJob   `json:"jobs"`
}

type rawStorage struct {
	Storage string `json:"storage"`
	Active  int    `json:"active"`
	Shared  int    `json:"shared"`
}

type rawContent struct {
	VolID string `json:"volid"`
	VMID  int    `json:"vmid"`
	CTime int64  `json:"ctime"`
	Size  int64  `json:"size"`
}

type rawTask struct {
	UPID      string `json:"upid"`
	Status    string `json:"status"`
	StartTime int64  `json:"starttime"`
	EndTime   int64  `json:"endtime"`
}

// get is a small GET+decode helper for the JSON endpoints added here. (Fetch
// and FetchNetwork predate it and are left untouched.)
func (c *Client) get(path string, out interface{}) error {
	host, tokenID, secret := c.creds()
	if tokenID == "" {
		return fmt.Errorf("proxmox not configured")
	}
	req, err := http.NewRequest(http.MethodGet, host+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", fmt.Sprintf("PVEAPIToken=%s=%s", tokenID, secret))
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("proxmox returned %s", resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// FetchBackups builds the cluster backup report: for every guest in
// /cluster/resources it finds the newest backup file (across each node's backup
// storages) and gathers recent vzdump job results.
//
// ponytail: local cluster only — everything reachable via this token. A detached
// paired agent's backups would need proxying through /agent/backups; add that if
// someone actually runs multi-node-without-a-cluster. Per-node calls are
// O(nodes×storages) but this is cached upstream (5 min) and backups change hourly.
func (c *Client) FetchBackups() (BackupReport, error) {
	snap, err := c.Fetch()
	if err != nil {
		return BackupReport{}, err
	}

	var entries []rawContent
	var jobs []BackupJob
	sharedSeen := map[string]bool{} // a shared storage repeats on every node — list once

	for _, node := range snap.Nodes {
		var stors struct {
			Data []rawStorage `json:"data"`
		}
		if err := c.get("/api2/json/nodes/"+node.ID+"/storage?content=backup", &stors); err == nil {
			for _, st := range stors.Data {
				if st.Active == 0 {
					continue
				}
				if st.Shared == 1 {
					if sharedSeen[st.Storage] {
						continue
					}
					sharedSeen[st.Storage] = true
				}
				var content struct {
					Data []rawContent `json:"data"`
				}
				if err := c.get("/api2/json/nodes/"+node.ID+"/storage/"+st.Storage+"/content?content=backup", &content); err != nil {
					continue
				}
				entries = append(entries, content.Data...)
			}
		}

		var tasks struct {
			Data []rawTask `json:"data"`
		}
		if err := c.get("/api2/json/nodes/"+node.ID+"/tasks?typefilter=vzdump&limit=50", &tasks); err == nil {
			for _, t := range tasks.Data {
				jobs = append(jobs, BackupJob{
					Node: node.ID, UPID: t.UPID, Status: t.Status,
					StartTime: t.StartTime, EndTime: t.EndTime,
				})
			}
		}
	}

	sort.Slice(jobs, func(i, j int) bool { return jobs[i].StartTime > jobs[j].StartTime })
	if len(jobs) > 50 {
		jobs = jobs[:50]
	}
	return buildReport(snap, newestPerVMID(entries), jobs), nil
}

// newestPerVMID keeps only the most recent backup file per guest. Pure — tested.
func newestPerVMID(entries []rawContent) map[int]rawContent {
	out := map[int]rawContent{}
	for _, e := range entries {
		if e.VMID == 0 {
			continue
		}
		if cur, ok := out[e.VMID]; !ok || e.CTime > cur.CTime {
			out[e.VMID] = e
		}
	}
	return out
}

// buildReport joins the guest roster with their newest backup. Pure — tested.
func buildReport(snap Snapshot, latest map[int]rawContent, jobs []BackupJob) BackupReport {
	if jobs == nil {
		jobs = []BackupJob{}
	}
	rep := BackupReport{Guests: []GuestBackup{}, Jobs: jobs}
	add := func(node string, g Guest, typ string) {
		gb := GuestBackup{VMID: g.VMID, Name: g.Name, Type: typ, Node: node, Status: g.Status}
		if e, ok := latest[g.VMID]; ok {
			gb.LastBackup = e.CTime
			gb.Size = e.Size
		}
		rep.Guests = append(rep.Guests, gb)
	}
	for _, n := range snap.Nodes {
		for _, vm := range n.VMs {
			add(n.ID, vm, "qemu")
		}
		for _, ct := range n.LXCs {
			add(n.ID, ct, "lxc")
		}
	}
	return rep
}
