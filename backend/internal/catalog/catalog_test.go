package catalog

import (
	"encoding/json"
	"os"
	"path/filepath"
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

// Stronger than the prefix check above: every loaded URL must pass validURL,
// which also forbids path traversal / non-installer paths under the repo.
func TestLoadedURLsPassValidURL(t *testing.T) {
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range c.All() {
		if !validURL(s.ScriptURL) {
			t.Fatalf("catalog %q has off-repo URL: %s", s.ID, s.ScriptURL)
		}
	}
}

func TestValidURLRejectsArbitrary(t *testing.T) {
	if !validURL(repoBase + "ct/jellyfin.sh") {
		t.Fatal("rejected a valid URL")
	}
	for _, u := range []string{
		"https://evil.example.com/x.sh",
		"https://raw.githubusercontent.com/attacker/repo/main/ct/x.sh",
		repoBase + "../../../etc/passwd",
		repoBase + "misc/build.func", // not a runnable installer path
	} {
		if validURL(u) {
			t.Fatalf("accepted an unsafe URL: %s", u)
		}
	}
}

// A poisoned overlay file must not be able to inject an off-repo URL.
func TestOverlayRejectsUnsafeEntries(t *testing.T) {
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(t.TempDir(), "overlay.json")
	data, _ := json.Marshal([]Script{
		{ID: "evil", ScriptURL: "https://evil.example.com/pwn.sh"},
		{ID: "legit-tool", ScriptURL: repoBase + "ct/legit-tool.sh"},
	})
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	c.SetOverlay(p)
	if _, ok := c.Get("evil"); ok {
		t.Fatal("overlay injected an off-repo entry")
	}
	if _, ok := c.Get("legit-tool"); !ok {
		t.Fatal("overlay dropped a valid entry")
	}
}

func TestTypeOf(t *testing.T) {
	for p, want := range map[string]string{
		"ct/jellyfin.sh": "ct", "vm/debian-vm.sh": "vm",
		"turnkey/turnkey.sh": "ct", "tools/pve/post-pve-install.sh": "pve",
		"tools/addon/runtipi.sh": "pve",
	} {
		if got := typeOf(p); got != want {
			t.Errorf("typeOf(%q)=%q want %q", p, got, want)
		}
	}
}
