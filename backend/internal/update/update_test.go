package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestNewer(t *testing.T) {
	cases := []struct {
		cur, lat string
		want     bool
	}{
		{"0.5.2", "0.6.0", true},
		{"v0.5.2", "v0.6.0", true},
		{"0.6.0", "0.6.0", false},
		{"0.6.0", "0.5.9", false},
		{"0.6.0", "0.6.1", true},
		{"1.0", "1.0.1", true},
		{"0.9.9", "1.0.0", true},
		{"dev", "0.6.0", false},             // source build: never nag
		{"0.6.0-3-gabcdef", "0.6.0", false}, // describe suffix ignored, equal
		{"0.6.0", "v1.0.0", true},
		{"0.6.0", "garbage", false},
	}
	for _, c := range cases {
		if got := newer(c.cur, c.lat); got != c.want {
			t.Errorf("newer(%q,%q)=%v want %v", c.cur, c.lat, got, c.want)
		}
	}
}

func TestParseChecksum(t *testing.T) {
	sum := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	body := fmt.Sprintf("%s  simpdash-linux-amd64\n%s *simpdash-linux-arm64\n", sum, sum)

	got, err := parseChecksum([]byte(body), "simpdash-linux-amd64")
	if err != nil || got != sum {
		t.Fatalf("amd64: got (%q, %v), want (%q, nil)", got, err, sum)
	}
	got, err = parseChecksum([]byte(body), "simpdash-linux-arm64")
	if err != nil || got != sum {
		t.Fatalf("arm64: got (%q, %v), want (%q, nil)", got, err, sum)
	}
	if _, err := parseChecksum([]byte(body), "missing"); err == nil {
		t.Fatal("expected error for missing asset")
	}
}

func TestApplySuccess(t *testing.T) {
	newBin := []byte("#!/bin/sh\necho v0.7.0\n")
	h := sha256.Sum256(newBin)
	sumHex := hex.EncodeToString(h[:])

	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/latest":
			json.NewEncoder(w).Encode(map[string]any{
				"tag_name": "v0.7.0",
				"html_url": "https://github.com/swindsor8/simpdash/releases/tag/v0.7.0",
				"assets": []map[string]string{
					{"name": "simpdash-linux-amd64", "browser_download_url": srv.URL + "/bin"},
					{"name": "checksums.txt", "browser_download_url": srv.URL + "/checksums.txt"},
				},
			})
		case "/bin":
			w.Write(newBin)
		case "/checksums.txt":
			fmt.Fprintf(w, "%s  simpdash-linux-amd64\n", sumHex)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	dir := t.TempDir()
	binPath := filepath.Join(dir, "simpdash")
	if err := os.WriteFile(binPath, []byte("old-binary"), 0755); err != nil {
		t.Fatal(err)
	}

	c := New("v0.6.0")
	c.latestURL = srv.URL + "/latest"
	c.goos = "linux"
	c.goarch = "amd64"
	c.execPathFn = func() (string, error) { return binPath, nil }
	c.verifyFn = func(ctx context.Context, p, tag string) error {
		if tag != "v0.7.0" {
			return fmt.Errorf("unexpected tag %q", tag)
		}
		return nil
	}

	res := c.ForceCheck()
	if !res.UpdateAvailable || !res.CanSelfUpdate || res.LatestVersion != "v0.7.0" {
		t.Fatalf("unexpected check result: %+v", res)
	}

	tag, err := c.Apply(context.Background())
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}
	if tag != "v0.7.0" {
		t.Fatalf("got tag %q, want v0.7.0", tag)
	}

	got, err := os.ReadFile(binPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(newBin) {
		t.Fatalf("binary not replaced: got %q", string(got))
	}

	// Second Apply while restarting should fail with ErrInProgress.
	if _, err := c.Apply(context.Background()); !errors.Is(err, ErrInProgress) {
		t.Fatalf("expected ErrInProgress, got %v", err)
	}
}

func TestApplyBadChecksumLeavesBinaryUntouched(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/latest":
			json.NewEncoder(w).Encode(map[string]any{
				"tag_name": "v0.7.0",
				"assets": []map[string]string{
					{"name": "simpdash-linux-amd64", "browser_download_url": srv.URL + "/bin"},
					{"name": "checksums.txt", "browser_download_url": srv.URL + "/checksums.txt"},
				},
			})
		case "/bin":
			w.Write([]byte("corrupted-bytes"))
		case "/checksums.txt":
			fmt.Fprintln(w, "0000000000000000000000000000000000000000000000000000000000000000  simpdash-linux-amd64")
		}
	}))
	defer srv.Close()

	dir := t.TempDir()
	binPath := filepath.Join(dir, "simpdash")
	if err := os.WriteFile(binPath, []byte("original-binary"), 0755); err != nil {
		t.Fatal(err)
	}

	c := New("v0.6.0")
	c.latestURL = srv.URL + "/latest"
	c.goos = "linux"
	c.goarch = "amd64"
	c.execPathFn = func() (string, error) { return binPath, nil }
	c.verifyFn = nil

	if _, err := c.Apply(context.Background()); err == nil {
		t.Fatal("expected checksum mismatch error")
	}

	got, err := os.ReadFile(binPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "original-binary" {
		t.Fatalf("original binary was modified: %q", string(got))
	}

	// Ensure no leftover temp files remain.
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected only original binary in dir, found %d entries", len(entries))
	}
}

func TestApplyDevBuildRejected(t *testing.T) {
	c := New("dev")
	if _, err := c.Apply(context.Background()); !errors.Is(err, ErrDevBuild) {
		t.Fatalf("expected ErrDevBuild, got %v", err)
	}
}
