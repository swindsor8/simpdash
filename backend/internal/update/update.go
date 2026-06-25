// Package update compares the running build against the latest GitHub release
// and reports whether a newer version is available. Results are cached so the
// dashboard never hits api.github.com on every page load.
package update

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// repo is where SimpDash itself is released. Not a per-deployment setting — it
// never changes — so it's a const, not config.
const repo = "swindsor8/simpdash"

// Result is the payload for GET /api/update-check.
type Result struct {
	CurrentVersion  string `json:"current_version"`
	LatestVersion   string `json:"latest_version"`
	UpdateAvailable bool   `json:"update_available"`
}

// Checker holds the running version and caches the latest-release lookup.
type Checker struct {
	current string
	ttl     time.Duration
	httpc   *http.Client

	mu      sync.Mutex
	cached  Result
	fetched time.Time
}

func New(current string) *Checker {
	return &Checker{
		current: current,
		ttl:     24 * time.Hour,
		httpc:   &http.Client{Timeout: 5 * time.Second},
	}
}

func (c *Checker) Current() string { return c.current }

// Check returns the cached result, refreshing from GitHub at most once per ttl.
// On any error it reports the current version with no update available — an
// update check must never break the dashboard.
func (c *Checker) Check() Result {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.fetched.IsZero() && time.Since(c.fetched) < c.ttl {
		return c.cached
	}
	res := Result{CurrentVersion: c.current}
	if latest, err := c.fetchLatest(); err == nil {
		res.LatestVersion = latest
		res.UpdateAvailable = newer(c.current, latest)
		c.cached = res
		c.fetched = time.Now() // only cache successful lookups
	}
	return res
}

func (c *Checker) fetchLatest() (string, error) {
	req, _ := http.NewRequest(http.MethodGet, "https://api.github.com/repos/"+repo+"/releases/latest", nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := c.httpc.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("github returned %s", resp.Status)
	}
	var body struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", err
	}
	return body.TagName, nil
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
