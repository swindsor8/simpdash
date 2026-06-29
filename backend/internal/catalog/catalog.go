// Package catalog loads the community-scripts install catalog and exposes lookup
// by id. The catalog is built from three layers, merged in this precedence:
//
//  1. manifest.yaml  — small, hand-vetted "verified" set (warnings curated).
//  2. snapshot.json  — the full community-scripts catalog (categories, resources)
//     bundled at build time so the whole list is browsable with no network.
//  3. overlay         — scripts discovered at runtime by Sync(), persisted to the
//     data dir, so new upstream scripts appear without a rebuild.
//
// Security: a script_url is NEVER taken from a client or trusted verbatim from a
// feed. Every URL — embedded, snapshotted, or Sync-discovered — must sit under
// repoBase with a path matching scriptPathRe, so a request (or a poisoned feed)
// can never point the executor at an arbitrary URL. The run handler looks a
// script up by id and uses the stored, validated URL.
package catalog

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

//go:embed manifest.yaml
var manifestYAML []byte

//go:embed snapshot.json
var snapshotJSON []byte

// repoBase is the ONLY host+path scripts are ever fetched from.
const repoBase = "https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/"

// treeAPI lists the repo's files; Sync reads it to find scripts added upstream.
const treeAPI = "https://api.github.com/repos/community-scripts/ProxmoxVE/git/trees/main?recursive=1"

// scriptPathRe matches the repo-relative paths we treat as runnable installers.
var scriptPathRe = regexp.MustCompile(`^(ct|vm|tools/pve|tools/addon|turnkey)/[a-z0-9][a-z0-9._-]*\.sh$`)

// Resources is the default resource allocation the script requests on the host.
type Resources struct {
	CPU    int `yaml:"cpu" json:"cpu"`
	RAMMb  int `yaml:"ram_mb" json:"ram_mb"`
	DiskGb int `yaml:"disk_gb" json:"disk_gb"`
}

// Script is one catalog entry. Fields map 1:1 to the manifest/snapshot and the
// JSON the frontend consumes. Verified/Source are set in code, not parsed from
// the manifest YAML.
type Script struct {
	ID          string    `yaml:"id" json:"id"`
	Name        string    `yaml:"name" json:"name"`
	Type        string    `yaml:"type" json:"type"` // ct | vm | pve
	Description string    `yaml:"description" json:"description"`
	Category    string    `yaml:"category" json:"category"`
	ScriptURL   string    `yaml:"script_url" json:"script_url"`
	Resources   Resources `yaml:"resources" json:"resources"`
	Warnings    []string  `yaml:"warnings" json:"warnings"`
	Logo        string    `yaml:"logo,omitempty" json:"logo,omitempty"` // selfh.st icon URL, if known
	Verified    bool      `yaml:"-" json:"verified"`                    // from the curated manifest
	Source      string    `yaml:"-" json:"source,omitempty"`            // curated | community
}

// Catalog is the merged catalog plus an id index. Guarded by mu because Sync
// mutates it at runtime while handlers read it.
type Catalog struct {
	mu          sync.RWMutex
	scripts     []Script
	byID        map[string]Script
	overlay     []Script // Sync-discovered entries, persisted to overlayPath
	overlayPath string
}

// Load parses the embedded manifest + snapshot and merges them (manifest wins on
// id). It fails loudly (called at startup) if either embed is malformed or a
// manifest entry is missing an id/url or duplicates one.
func Load() (*Catalog, error) {
	var manifest []Script
	if err := yaml.Unmarshal(manifestYAML, &manifest); err != nil {
		return nil, fmt.Errorf("parse catalog manifest: %w", err)
	}
	var snap []Script
	if err := json.Unmarshal(snapshotJSON, &snap); err != nil {
		return nil, fmt.Errorf("parse catalog snapshot: %w", err)
	}

	// Index snapshot logos so curated manifest entries inherit an icon for free.
	snapLogo := map[string]string{}
	for _, s := range snap {
		if s.Logo != "" {
			snapLogo[s.ID] = s.Logo
		}
	}

	c := &Catalog{byID: map[string]Script{}}
	for _, s := range manifest {
		if s.ID == "" || s.ScriptURL == "" {
			return nil, fmt.Errorf("catalog entry missing id or script_url: %+v", s)
		}
		if _, dup := c.byID[s.ID]; dup {
			return nil, fmt.Errorf("duplicate catalog id: %s", s.ID)
		}
		s.Verified, s.Source = true, "curated"
		if s.Logo == "" {
			s.Logo = snapLogo[s.ID]
		}
		c.put(s)
	}
	for _, s := range snap {
		if _, exists := c.byID[s.ID]; exists || !validURL(s.ScriptURL) {
			continue
		}
		if s.Source == "" {
			s.Source = "community"
		}
		c.put(s)
	}
	return c, nil
}

// put adds/indexes a script. Caller holds the lock (or is in single-threaded Load).
func (c *Catalog) put(s Script) {
	c.scripts = append(c.scripts, s)
	c.byID[s.ID] = s
}

// SetOverlay points the catalog at a persisted overlay file and loads it. Call
// once after Load, before serving. Missing/unreadable file is not an error.
func (c *Catalog) SetOverlay(p string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.overlayPath = p
	data, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var extra []Script
	if json.Unmarshal(data, &extra) != nil {
		return
	}
	for _, s := range extra {
		if _, exists := c.byID[s.ID]; exists || !validURL(s.ScriptURL) {
			continue
		}
		s.Verified, s.Source = false, "community"
		c.overlay = append(c.overlay, s)
		c.put(s)
	}
}

// All returns a copy of the scripts (copied so a concurrent Sync can't mutate
// the slice a handler is ranging over).
func (c *Catalog) All() []Script {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make([]Script, len(c.scripts))
	copy(out, c.scripts)
	return out
}

// Get returns the script with the given id.
func (c *Catalog) Get(id string) (Script, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	s, ok := c.byID[id]
	return s, ok
}

// Sync fetches the repo's current file list and adds any runnable script not
// already in the catalog as an uncategorised ("Miscellaneous") community entry,
// persisting the additions to the overlay file. Categories/descriptions aren't
// available from a live feed, so discovered scripts land in Miscellaneous until
// the bundled snapshot is regenerated. Returns how many were added and the new
// total.
func (c *Catalog) Sync(ctx context.Context) (added, total int, err error) {
	paths, err := fetchScriptPaths(ctx)
	if err != nil {
		return 0, 0, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, p := range paths {
		id := strings.TrimSuffix(path.Base(p), ".sh")
		// alpine-* are install-method variants of an existing app, not distinct
		// apps — skip so Sync doesn't litter the catalog with duplicates.
		// ponytail: heuristic; the only signal we have without app metadata.
		if id == "" || strings.HasPrefix(id, "alpine-") {
			continue
		}
		if _, exists := c.byID[id]; exists {
			continue
		}
		t := typeOf(p)
		s := Script{
			ID: id, Name: titleCase(id), Type: t, Category: "Miscellaneous",
			ScriptURL: repoBase + p, Warnings: warningsFor(t),
			Verified: false, Source: "community",
		}
		c.overlay = append(c.overlay, s)
		c.put(s)
		added++
	}
	total = len(c.scripts)
	if added > 0 && c.overlayPath != "" {
		if data, e := json.MarshalIndent(c.overlay, "", " "); e == nil {
			err = os.WriteFile(c.overlayPath, data, 0o644)
		}
	}
	return added, total, err
}

// fetchScriptPaths returns the repo-relative paths of all runnable installers.
func fetchScriptPaths(ctx context.Context) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, treeAPI, nil)
	req.Header.Set("User-Agent", "simpdash") // GitHub API requires a UA
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github tree: HTTP %d", resp.StatusCode)
	}
	var body struct {
		Tree      []struct{ Path string `json:"path"` } `json:"tree"`
		Truncated bool                                  `json:"truncated"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	if body.Truncated {
		return nil, fmt.Errorf("github tree truncated; cannot sync reliably")
	}
	var out []string
	for _, e := range body.Tree {
		if scriptPathRe.MatchString(e.Path) {
			out = append(out, e.Path)
		}
	}
	return out, nil
}

func validURL(u string) bool {
	return strings.HasPrefix(u, repoBase) && scriptPathRe.MatchString(strings.TrimPrefix(u, repoBase))
}

func typeOf(p string) string {
	switch {
	case strings.HasPrefix(p, "vm/"):
		return "vm"
	case strings.HasPrefix(p, "ct/"), strings.HasPrefix(p, "turnkey/"):
		return "ct"
	case strings.HasPrefix(p, "tools/addon/"):
		return "addon" // installs into an existing target, not a fresh guest
	default: // tools/pve
		return "pve"
	}
}

func warningsFor(t string) []string {
	switch t {
	case "ct":
		return []string{"Creates a new LXC"}
	case "vm":
		return []string{"Creates a new VM"}
	case "addon":
		return []string{"Runs as root in the selected target"}
	default:
		return []string{"Runs as root on the host"}
	}
}

// titleCase turns a slug ("nginx-proxy-manager") into a display name.
func titleCase(slug string) string {
	parts := strings.Split(slug, "-")
	for i, w := range parts {
		if w != "" {
			parts[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(parts, " ")
}
