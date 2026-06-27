package proxmox

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"
)

// Snapshot is the reshaped resource view sent to the frontend.
// Matches API_CONTRACT.md "Resource snapshot shape" exactly.
type Snapshot struct {
	Nodes []Node `json:"nodes"`
}

type Node struct {
	ID      string  `json:"id"`
	Status  string  `json:"status"`
	CPU     float64 `json:"cpu"`
	MaxCPU  int     `json:"maxcpu"`
	Mem     int64   `json:"mem"`
	MaxMem  int64   `json:"maxmem"`
	Disk    int64   `json:"disk"`
	MaxDisk int64   `json:"maxdisk"`
	Uptime  int64   `json:"uptime"`
	Managed bool    `json:"managed"`
	VMs     []Guest `json:"vms"`
	LXCs    []Guest `json:"lxcs"`
}

type Guest struct {
	VMID    int     `json:"vmid"`
	Name    string  `json:"name"`
	Status  string  `json:"status"`
	CPU     float64 `json:"cpu"`
	Mem     int64   `json:"mem"`
	MaxMem  int64   `json:"maxmem"`
	Disk    *int64  `json:"disk"`              // null for VMs (cluster/resources doesn't report it)
	MaxDisk *int64  `json:"maxdisk,omitempty"` // present for LXCs only, per contract
	Uptime  int64   `json:"uptime"`
	NetIn   int64   `json:"netin"`  // cumulative bytes received since guest start
	NetOut  int64   `json:"netout"` // cumulative bytes sent since guest start
}

// NetworkIface is one interface from GET /nodes/{node}/network.
type NetworkIface struct {
	Iface       string `json:"iface"`
	Type        string `json:"type"`
	Address     string `json:"address,omitempty"`
	Netmask     string `json:"netmask,omitempty"`
	CIDR        string `json:"cidr,omitempty"`
	Gateway     string `json:"gateway,omitempty"`
	BridgePorts string `json:"bridge_ports,omitempty"`
	Active      int    `json:"active"`
	Autostart   int    `json:"autostart"`
}

// FetchNetwork returns the network interfaces for a node. Pass the node name
// (hostname). Callers typically pass the local node name.
func (c *Client) FetchNetwork(node string) ([]NetworkIface, error) {
	host, tokenID, secret := c.creds()
	if tokenID == "" {
		return nil, fmt.Errorf("proxmox not configured")
	}
	req, err := http.NewRequest(http.MethodGet, host+"/api2/json/nodes/"+node+"/network", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("PVEAPIToken=%s=%s", tokenID, secret))
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("proxmox returned %s", resp.Status)
	}
	var body struct {
		Data []NetworkIface `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	return body.Data, nil
}

// rawResource is one entry from GET /cluster/resources (only fields we use).
type rawResource struct {
	Type    string  `json:"type"` // "node" | "qemu" | "lxc" | "storage" | ...
	Node    string  `json:"node"`
	Name    string  `json:"name"`
	VMID    int     `json:"vmid"`
	Status  string  `json:"status"`
	CPU     float64 `json:"cpu"`
	MaxCPU  int     `json:"maxcpu"`
	Mem     int64   `json:"mem"`
	MaxMem  int64   `json:"maxmem"`
	Disk    int64   `json:"disk"`
	MaxDisk int64   `json:"maxdisk"`
	Uptime  int64   `json:"uptime"`
	NetIn   int64   `json:"netin"`
	NetOut  int64   `json:"netout"`
}

// Client calls the Proxmox VE API. Credentials are set after token
// provisioning (see provision.go) and may change at runtime, so they live
// behind a mutex rather than being fixed at construction.
type Client struct {
	http *http.Client

	mu      sync.RWMutex
	host    string // e.g. https://127.0.0.1:8006
	tokenID string // e.g. simpdash@pve!dashtoken
	secret  string
}

func NewClient() *Client {
	return &Client{
		http: &http.Client{
			Timeout: 8 * time.Second,
			// ponytail: InsecureSkipVerify is deliberate — Proxmox ships a
			// self-signed cert by default and SimpDash talks to it over the
			// LAN (usually localhost). Pin a CA here if you front PVE with a
			// real cert. Not silent: this comment is the knob.
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		},
	}
}

// SetCreds updates the credentials used for subsequent calls.
func (c *Client) SetCreds(host, tokenID, secret string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.host, c.tokenID, c.secret = host, tokenID, secret
}

func (c *Client) creds() (host, tokenID, secret string) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.host, c.tokenID, c.secret
}

// Configured reports whether credentials have been set.
func (c *Client) Configured() bool {
	_, tokenID, _ := c.creds()
	return tokenID != ""
}

// Fetch returns the current cluster resources reshaped into a Snapshot.
func (c *Client) Fetch() (Snapshot, error) {
	host, tokenID, secret := c.creds()
	if tokenID == "" {
		return Snapshot{}, fmt.Errorf("proxmox not configured")
	}
	req, err := http.NewRequest(http.MethodGet, host+"/api2/json/cluster/resources", nil)
	if err != nil {
		return Snapshot{}, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("PVEAPIToken=%s=%s", tokenID, secret))
	resp, err := c.http.Do(req)
	if err != nil {
		return Snapshot{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Snapshot{}, fmt.Errorf("proxmox returned %s", resp.Status)
	}
	var body struct {
		Data []rawResource `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return Snapshot{}, err
	}
	return reshape(body.Data), nil
}

// reshape groups the flat /cluster/resources list into per-node objects with
// vms and lxcs sub-arrays. Pure function — unit-tested in client_test.go.
func reshape(raw []rawResource) Snapshot {
	nodes := map[string]*Node{}
	order := []string{}

	for _, r := range raw {
		if r.Type == "node" {
			nodes[r.Node] = &Node{
				ID:      r.Node,
				Status:  r.Status,
				CPU:     r.CPU,
				MaxCPU:  r.MaxCPU,
				Mem:     r.Mem,
				MaxMem:  r.MaxMem,
				Disk:    r.Disk,
				MaxDisk: r.MaxDisk,
				Uptime:  r.Uptime,
				Managed: true, // ponytail: hardcoded — monitor-only badging is M5
				VMs:     []Guest{},
				LXCs:    []Guest{},
			}
			order = append(order, r.Node)
		}
	}

	for _, r := range raw {
		switch r.Type {
		case "qemu":
			n := nodes[r.Node]
			if n == nil {
				continue
			}
			n.VMs = append(n.VMs, Guest{
				VMID:   r.VMID,
				Name:   r.Name,
				Status: r.Status,
				CPU:    r.CPU,
				Mem:    r.Mem,
				MaxMem: r.MaxMem,
				Disk:   nil, // VMs report null disk per contract
				Uptime: r.Uptime,
				NetIn:  r.NetIn,
				NetOut: r.NetOut,
			})
		case "lxc":
			n := nodes[r.Node]
			if n == nil {
				continue
			}
			disk, maxdisk := r.Disk, r.MaxDisk
			n.LXCs = append(n.LXCs, Guest{
				VMID:    r.VMID,
				Name:    r.Name,
				Status:  r.Status,
				CPU:     r.CPU,
				Mem:     r.Mem,
				MaxMem:  r.MaxMem,
				Disk:    &disk,
				MaxDisk: &maxdisk,
				Uptime:  r.Uptime,
				NetIn:   r.NetIn,
				NetOut:  r.NetOut,
			})
		}
	}

	sort.Strings(order)
	out := Snapshot{Nodes: []Node{}}
	for _, name := range order {
		out.Nodes = append(out.Nodes, *nodes[name])
	}
	return out
}
