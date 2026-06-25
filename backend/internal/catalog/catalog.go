// Package catalog loads the curated list of community-scripts install scripts
// from an embedded YAML manifest and exposes lookup by id.
//
// Security: script_url values come ONLY from this embedded manifest, never from
// a client. The run handler looks a script up by id and uses the manifest's
// URL, so a request can never point the executor at an arbitrary URL.
package catalog

import (
	_ "embed"
	"fmt"

	"gopkg.in/yaml.v3"
)

//go:embed manifest.yaml
var manifestYAML []byte

// Resources is the default resource allocation the script requests on the host.
type Resources struct {
	CPU    int `yaml:"cpu" json:"cpu"`
	RAMMb  int `yaml:"ram_mb" json:"ram_mb"`
	DiskGb int `yaml:"disk_gb" json:"disk_gb"`
}

// Script is one catalog entry. Fields map 1:1 to the manifest and the JSON the
// frontend consumes.
type Script struct {
	ID          string    `yaml:"id" json:"id"`
	Name        string    `yaml:"name" json:"name"`
	Type        string    `yaml:"type" json:"type"` // "ct" or "vm"
	Description string    `yaml:"description" json:"description"`
	Category    string    `yaml:"category" json:"category"`
	ScriptURL   string    `yaml:"script_url" json:"script_url"`
	Resources   Resources `yaml:"resources" json:"resources"`
	Warnings    []string  `yaml:"warnings" json:"warnings"`
}

// Catalog is the loaded manifest plus an id index for O(1) lookup.
type Catalog struct {
	scripts []Script
	byID    map[string]Script
}

// Load parses the embedded manifest. It fails loudly (called at startup) if the
// manifest is malformed, an entry is missing an id/url, or an id is duplicated —
// a broken catalog should stop the build/boot, not ship a half-working list.
func Load() (*Catalog, error) {
	var scripts []Script
	if err := yaml.Unmarshal(manifestYAML, &scripts); err != nil {
		return nil, fmt.Errorf("parse catalog manifest: %w", err)
	}
	byID := make(map[string]Script, len(scripts))
	for _, s := range scripts {
		if s.ID == "" || s.ScriptURL == "" {
			return nil, fmt.Errorf("catalog entry missing id or script_url: %+v", s)
		}
		if _, dup := byID[s.ID]; dup {
			return nil, fmt.Errorf("duplicate catalog id: %s", s.ID)
		}
		byID[s.ID] = s
	}
	return &Catalog{scripts: scripts, byID: byID}, nil
}

// All returns the scripts in manifest order.
func (c *Catalog) All() []Script { return c.scripts }

// Get returns the script with the given id.
func (c *Catalog) Get(id string) (Script, bool) {
	s, ok := c.byID[id]
	return s, ok
}
