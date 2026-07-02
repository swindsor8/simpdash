// Package pbs is a minimal read-only Proxmox Backup Server client: datastore
// usage + latest snapshot/verification state per guest.
//
// TLS: PBS ships a self-signed certificate, and unlike the health checker we
// SEND CREDENTIALS on every request — so "skip verify" is not an option here.
// The connection must either chain to a real CA or match a pinned SHA-256
// certificate fingerprint (the same fingerprint PBS prints in its dashboard
// and that proxmox-backup-client pins).
package pbs

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type Client struct {
	mu     sync.RWMutex
	base   string // https://host:8007
	token  string // "user@pbs!name:secret" — full PBSAPIToken header value
	client *http.Client
}

func New() *Client { return &Client{} }

// Configured reports whether credentials are set.
func (c *Client) Configured() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.base != "" && c.token != ""
}

// SetConfig (re)configures the client. fingerprint is the sha256 cert pin in
// PBS's colon-separated hex form; empty means "must chain to a system CA".
func (c *Client) SetConfig(baseURL, tokenID, secret, fingerprint string) error {
	if baseURL == "" {
		c.mu.Lock()
		c.base, c.token, c.client = "", "", nil
		c.mu.Unlock()
		return nil
	}
	u, err := url.Parse(baseURL)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return fmt.Errorf("PBS URL must be https://host:port")
	}

	tlsCfg := &tls.Config{}
	if fingerprint != "" {
		pin := strings.ToLower(strings.ReplaceAll(fingerprint, ":", ""))
		if len(pin) != 64 {
			return fmt.Errorf("fingerprint must be a sha256 hex string (64 chars, colons optional)")
		}
		// Pin the leaf certificate: standard chain verification is skipped and
		// replaced by an exact match on the presented cert's sha256.
		tlsCfg.InsecureSkipVerify = true
		tlsCfg.VerifyPeerCertificate = func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
			if len(rawCerts) == 0 {
				return fmt.Errorf("no certificate presented")
			}
			sum := sha256.Sum256(rawCerts[0])
			if hex.EncodeToString(sum[:]) != pin {
				return fmt.Errorf("PBS certificate fingerprint mismatch — possible MITM or cert rotation")
			}
			return nil
		}
	}

	c.mu.Lock()
	c.base = strings.TrimRight(baseURL, "/")
	c.token = tokenID + ":" + secret
	c.client = &http.Client{
		Timeout:   10 * time.Second,
		Transport: &http.Transport{TLSClientConfig: tlsCfg},
	}
	c.mu.Unlock()
	return nil
}

func (c *Client) getJSON(path string, out any) error {
	c.mu.RLock()
	base, token, client := c.base, c.token, c.client
	c.mu.RUnlock()
	if base == "" || client == nil {
		return fmt.Errorf("PBS not configured")
	}
	req, err := http.NewRequest(http.MethodGet, base+"/api2/json"+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "PBSAPIToken="+token)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("PBS returned %s", resp.Status)
	}
	var body struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return err
	}
	return json.Unmarshal(body.Data, out)
}

// Datastore is one PBS datastore's usage.
type Datastore struct {
	Store string `json:"store"`
	Total int64  `json:"total"`
	Used  int64  `json:"used"`
	Avail int64  `json:"avail"`
}

// GuestBackup summarizes the newest PBS snapshot for one guest.
type GuestBackup struct {
	Store      string `json:"store"`
	Type       string `json:"type"` // "vm" | "ct"
	ID         string `json:"id"`   // vmid as string
	LastBackup int64  `json:"last_backup"`
	Verified   string `json:"verified"` // "ok" | "failed" | "none"
	Count      int    `json:"count"`    // snapshots kept for this guest
}

// Status is the full PBS report served to the frontend.
type Status struct {
	Datastores []Datastore   `json:"datastores"`
	Guests     []GuestBackup `json:"guests"`
}

type rawSnapshot struct {
	BackupType string `json:"backup-type"`
	BackupID   string `json:"backup-id"`
	BackupTime int64  `json:"backup-time"`
	Verify     *struct {
		State string `json:"state"` // "ok" | "failed"
	} `json:"verification"`
}

// FetchStatus returns datastore usage and the latest snapshot per guest.
func (c *Client) FetchStatus() (Status, error) {
	var stores []Datastore
	if err := c.getJSON("/status/datastore-usage", &stores); err != nil {
		return Status{}, err
	}

	out := Status{Datastores: stores, Guests: []GuestBackup{}}
	latest := map[string]*GuestBackup{}
	for _, ds := range stores {
		var snaps []rawSnapshot
		if err := c.getJSON("/admin/datastore/"+url.PathEscape(ds.Store)+"/snapshots", &snaps); err != nil {
			continue // datastore may deny this token — report the rest
		}
		for _, sn := range snaps {
			key := ds.Store + "/" + sn.BackupType + "/" + sn.BackupID
			g := latest[key]
			if g == nil {
				g = &GuestBackup{Store: ds.Store, Type: sn.BackupType, ID: sn.BackupID, Verified: "none"}
				latest[key] = g
			}
			g.Count++
			if sn.BackupTime >= g.LastBackup {
				g.LastBackup = sn.BackupTime
				g.Verified = "none"
				if sn.Verify != nil {
					g.Verified = sn.Verify.State
				}
			}
		}
	}
	for _, g := range latest {
		out.Guests = append(out.Guests, *g)
	}
	return out, nil
}
