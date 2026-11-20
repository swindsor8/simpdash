// Package update compares the running build against the latest GitHub release,
// reports whether a newer version is available, and can self-update the running
// binary in place from verified release assets.
package update

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// repo is where SimpDash itself is released. Not a per-deployment setting — it
// never changes — so it's a const, not config.
const (
	repo          = "swindsor8/simpdash"
	latestAPIURL  = "https://api.github.com/repos/" + repo + "/releases/latest"
	maxChecksumSz = 1 << 20   // 1 MiB
	maxBinarySz   = 256 << 20 // 256 MiB
)

var (
	// ErrInProgress is returned when a self-update is already running or restarting.
	ErrInProgress = errors.New("a self-update is already in progress")
	// ErrUpToDate is returned when no newer release exists.
	ErrUpToDate = errors.New("already running the latest version")
	// ErrDevBuild is returned when attempting to self-update a non-release ("dev") build.
	ErrDevBuild = errors.New("cannot self-update a development build")
)

// Result is the payload for GET /api/update-check.
type Result struct {
	CurrentVersion  string `json:"current_version"`
	LatestVersion   string `json:"latest_version"`
	UpdateAvailable bool   `json:"update_available"`
	ReleaseURL      string `json:"release_url,omitempty"`
	CanSelfUpdate   bool   `json:"can_self_update"`
}

type releaseInfo struct {
	TagName     string
	HTMLURL     string
	AssetName   string
	AssetURL    string
	ChecksumURL string
}

// Checker holds the running version, caches the latest-release lookup, and
// coordinates atomic in-place binary upgrades.
type Checker struct {
	current   string
	ttl       time.Duration
	httpc     *http.Client
	dlClient  *http.Client
	latestURL string
	goos      string
	goarch    string

	// Injectable hooks for tests.
	execPathFn func() (string, error)
	verifyFn   func(ctx context.Context, binPath, expectedTag string) error

	mu       sync.Mutex
	cached   Result
	fetched  time.Time
	updating bool
}

func New(current string) *Checker {
	return &Checker{
		current:    current,
		ttl:        24 * time.Hour,
		httpc:      &http.Client{Timeout: 5 * time.Second},
		dlClient:   &http.Client{Timeout: 2 * time.Minute},
		latestURL:  latestAPIURL,
		goos:       runtime.GOOS,
		goarch:     runtime.GOARCH,
		execPathFn: resolvedExecutablePath,
		verifyFn:   verifyBinary,
	}
}

func (c *Checker) Current() string { return c.current }

// Check returns the cached result, refreshing from GitHub at most once per ttl.
// On any error it reports the current version with no update available — an
// update check must never break the dashboard.
func (c *Checker) Check() Result {
	return c.check(false)
}

// ForceCheck bypasses the cache and queries GitHub immediately.
func (c *Checker) ForceCheck() Result {
	return c.check(true)
}

func (c *Checker) check(force bool) Result {
	c.mu.Lock()
	if !force && !c.fetched.IsZero() && time.Since(c.fetched) < c.ttl {
		res := c.cached
		c.mu.Unlock()
		return res
	}
	c.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	res := Result{CurrentVersion: c.current}
	if rel, err := c.fetchLatest(ctx); err == nil {
		avail := newer(c.current, rel.TagName)
		res.LatestVersion = rel.TagName
		res.UpdateAvailable = avail
		res.ReleaseURL = rel.HTMLURL
		res.CanSelfUpdate = avail && c.goos == "linux" && rel.AssetURL != "" && rel.ChecksumURL != ""

		c.mu.Lock()
		c.cached = res
		c.fetched = time.Now() // only cache successful lookups
		c.mu.Unlock()
	}
	return res
}

// Apply downloads the latest GitHub Release binary for this architecture,
// verifies its SHA-256 checksum against checksums.txt, smoke-tests it with
// --version, and atomically replaces the running executable on disk.
//
// On success the updating flag stays set because the caller is expected to
// restart the process immediately. On error the flag is cleared and any temp
// file is removed, leaving the existing binary untouched.
func (c *Checker) Apply(ctx context.Context) (string, error) {
	if _, ok := parse(c.current); !ok {
		return "", ErrDevBuild
	}

	c.mu.Lock()
	if c.updating {
		c.mu.Unlock()
		return "", ErrInProgress
	}
	c.updating = true
	c.mu.Unlock()

	succeeded := false
	defer func() {
		if !succeeded {
			c.mu.Lock()
			c.updating = false
			c.mu.Unlock()
		}
	}()

	rel, err := c.fetchLatest(ctx)
	if err != nil {
		return "", fmt.Errorf("fetch latest release: %w", err)
	}
	if !newer(c.current, rel.TagName) {
		return "", ErrUpToDate
	}
	if c.goos != "linux" {
		return "", fmt.Errorf("self-update is only supported on linux (running %s)", c.goos)
	}
	if rel.AssetURL == "" {
		return "", fmt.Errorf("release %s does not include %s", rel.TagName, rel.AssetName)
	}
	if rel.ChecksumURL == "" {
		return "", fmt.Errorf("release %s does not include checksums.txt", rel.TagName)
	}

	expectedHex, err := c.fetchChecksum(ctx, rel.ChecksumURL, rel.AssetName)
	if err != nil {
		return "", fmt.Errorf("verify checksum metadata: %w", err)
	}

	execPath, err := c.execPathFn()
	if err != nil {
		return "", fmt.Errorf("locate current binary: %w", err)
	}
	dir := filepath.Dir(execPath)

	tmp, err := os.CreateTemp(dir, ".simpdash-update-*")
	if err != nil {
		return "", fmt.Errorf("prepare temp binary in %s: %w", dir, err)
	}
	tmpPath := tmp.Name()
	keepTmp := false
	defer func() {
		if !keepTmp {
			os.Remove(tmpPath)
		}
	}()

	gotHex, err := c.downloadToFile(ctx, rel.AssetURL, tmp)
	if err != nil {
		tmp.Close()
		return "", fmt.Errorf("download %s: %w", rel.AssetName, err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return "", fmt.Errorf("sync downloaded binary: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return "", fmt.Errorf("close downloaded binary: %w", err)
	}

	if subtle.ConstantTimeCompare([]byte(gotHex), []byte(expectedHex)) != 1 {
		return "", fmt.Errorf("checksum mismatch for %s (got %s, want %s)", rel.AssetName, gotHex, expectedHex)
	}

	if err := os.Chmod(tmpPath, 0755); err != nil {
		return "", fmt.Errorf("chmod downloaded binary: %w", err)
	}

	if c.verifyFn != nil {
		if err := c.verifyFn(ctx, tmpPath, rel.TagName); err != nil {
			return "", fmt.Errorf("new binary failed verification: %w", err)
		}
	}

	if err := os.Rename(tmpPath, execPath); err != nil {
		return "", fmt.Errorf("replace binary %s: %w", execPath, err)
	}
	keepTmp = true
	succeeded = true
	return rel.TagName, nil
}

// ClearUpdating resets the in-progress lock if the caller fails to restart the
// service after Apply succeeded, so the user can retry later if needed.
func (c *Checker) ClearUpdating() {
	c.mu.Lock()
	c.updating = false
	c.mu.Unlock()
}

func (c *Checker) fetchLatest(ctx context.Context) (releaseInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.latestURL, nil)
	if err != nil {
		return releaseInfo{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := c.httpc.Do(req)
	if err != nil {
		return releaseInfo{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return releaseInfo{}, fmt.Errorf("github returned %s", resp.Status)
	}
	var body struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
		Assets  []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxChecksumSz)).Decode(&body); err != nil {
		return releaseInfo{}, err
	}

	wantAsset := fmt.Sprintf("simpdash-%s-%s", c.goos, c.goarch)
	rel := releaseInfo{
		TagName:   body.TagName,
		HTMLURL:   body.HTMLURL,
		AssetName: wantAsset,
	}
	for _, a := range body.Assets {
		switch a.Name {
		case wantAsset:
			rel.AssetURL = a.BrowserDownloadURL
		case "checksums.txt":
			rel.ChecksumURL = a.BrowserDownloadURL
		}
	}
	return rel, nil
}

func (c *Checker) fetchChecksum(ctx context.Context, url, filename string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := c.dlClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("checksum download returned %s", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxChecksumSz))
	if err != nil {
		return "", err
	}
	return parseChecksum(data, filename)
}

func (c *Checker) downloadToFile(ctx context.Context, url string, dst io.Writer) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := c.dlClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("binary download returned %s", resp.Status)
	}

	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(dst, h), io.LimitReader(resp.Body, maxBinarySz+1))
	if err != nil {
		return "", err
	}
	if n > maxBinarySz {
		return "", fmt.Errorf("binary exceeds maximum allowed size (%d bytes)", maxBinarySz)
	}
	if n == 0 {
		return "", errors.New("downloaded binary is empty")
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// parseChecksum finds the SHA-256 hex digest for filename in a standard
// sha256sum output file ("<hex>  <filename>" or "<hex> *<filename>").
func parseChecksum(data []byte, filename string) (string, error) {
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := strings.TrimPrefix(fields[1], "*")
		if name != filename {
			continue
		}
		sum := strings.ToLower(fields[0])
		if len(sum) != 64 {
			return "", fmt.Errorf("invalid sha256 length for %s", filename)
		}
		if _, err := hex.DecodeString(sum); err != nil {
			return "", fmt.Errorf("invalid sha256 hex for %s", filename)
		}
		return sum, nil
	}
	return "", fmt.Errorf("no checksum entry found for %s", filename)
}

func resolvedExecutablePath() (string, error) {
	p, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(p)
}

func verifyBinary(ctx context.Context, binPath, expectedTag string) error {
	vctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(vctx, binPath, "--version").CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	got := strings.TrimPrefix(strings.TrimSpace(string(out)), "v")
	want := strings.TrimPrefix(strings.TrimSpace(expectedTag), "v")
	if got == "" {
		return errors.New("empty --version output")
	}
	if want != "" && got != want {
		return fmt.Errorf("version mismatch: binary reports %q, expected %q", strings.TrimSpace(string(out)), expectedTag)
	}
	return nil
}

// newer reports whether latest is a strictly higher version than current. Both
// are dotted numeric versions, optionally "v"-prefixed and optionally suffixed
// (e.g. the "-3-gabcdef" git-describe tail), which we ignore. A current build
// that isn't a clean release ("dev" or otherwise unparseable) never reports an
// update — we don't nag people running source builds.
func newer(current, latest string) bool {
	cur, ok1 := parse(current)
	lat, ok2 := parse(latest)
	if !ok1 || !ok2 {
		return false
	}
	for i := 0; i < len(cur) || i < len(lat); i++ {
		a, b := 0, 0
		if i < len(cur) {
			a = cur[i]
		}
		if i < len(lat) {
			b = lat[i]
		}
		if a != b {
			return b > a
		}
	}
	return false
}

func parse(v string) ([]int, bool) {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i] // drop git-describe / build suffix
	}
	if v == "" {
		return nil, false
	}
	parts := strings.Split(v, ".")
	out := make([]int, len(parts))
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return nil, false
		}
		out[i] = n
	}
	return out, true
}
