package catalog

import (
	"strings"
	"testing"
)

// The embedded manifest must load, be non-trivial, and every URL must point at
// the community-scripts repo (the only place we'll fetch+run code from as root).
func TestManifestLoads(t *testing.T) {
	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if n := len(c.All()); n < 5 {
		t.Errorf("catalog size = %d, want >= 5", n)
	}
	for _, s := range c.All() {
		if !strings.HasPrefix(s.ScriptURL, "https://raw.githubusercontent.com/community-scripts/ProxmoxVE/") {
			t.Errorf("%s: script_url not a community-scripts raw URL: %q", s.ID, s.ScriptURL)
		}
		if s.Name == "" || s.Category == "" {
			t.Errorf("%s: missing name or category", s.ID)
		}
	}
}

func TestGet(t *testing.T) {
	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if _, ok := c.Get("pihole"); !ok {
		t.Error("Get(pihole) = not found")
	}
	if _, ok := c.Get("definitely-not-a-script"); ok {
		t.Error("Get(bogus) = found, want not found")
	}
}
