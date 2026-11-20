package api

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"simpdash/internal/store"
)

// Service health checker: probes every stored service-link URL on an interval
// and exposes up/down + latency, so guest cards can show a live status dot.
//
// Security posture:
//   - Probes only admin-stored URLs (validated http(s) at PUT time); the
//     /api/service-health endpoint returns status metadata only, never
//     response bodies — so it can't be used to read internal services.
//   - No cookies/credentials are sent; redirects are capped; responses are
//     drained to a small cap and discarded.
//   - TLS verification is skipped (self-signed homelab certs) — acceptable
//     because nothing secret is transmitted and only reachability is reported.
type healthChecker struct {
	links *store.ServiceLinksDB

	// onChange, when set, fires after 3 consecutive failures (up=false) or on
	// recovery after an alert (up=true). Runs asynchronously so probes never stall.
	onChange func(key, label, url string, up bool, status int)

	mu        sync.Mutex
	results   map[string]healthResult
	failCount map[string]int
	alerted   map[string]bool

	kick chan struct{} // wake() nudges the loop after link edits
}

type healthResult struct {
	Up        bool  `json:"up"`
	Status    int   `json:"status,omitempty"` // last HTTP status (0 on connection error)
	LatencyMS int64 `json:"latency_ms"`
	CheckedAt int64 `json:"checked_at"` // unix seconds
}

var healthClient = &http.Client{
	Timeout: 5 * time.Second,
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return fmt.Errorf("too many redirects")
		}
		return nil
	},
}

func newHealthChecker(links *store.ServiceLinksDB) *healthChecker {
	return &healthChecker{
		links:     links,
		results:   map[string]healthResult{},
		failCount: map[string]int{},
		alerted:   map[string]bool{},
		kick:      make(chan struct{}, 1),
	}
}

// wake nudges the checker to run soon (after a link is added/edited).
func (h *healthChecker) wake() {
	select {
	case h.kick <- struct{}{}:
	default:
	}
}

// run probes all links every 30s until ctx is cancelled. Start in a goroutine.
func (h *healthChecker) run(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	h.sweep(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			h.sweep(ctx)
		case <-h.kick:
			h.sweep(ctx)
		}
	}
}

type healthTarget struct {
	url   string
	label string
}

func (h *healthChecker) sweep(ctx context.Context) {
	links, err := h.links.GetAll()
	if err != nil {
		return
	}
	// key → target for the primary link and each extra ("key" / "key#0", "key#1"…).
	targets := map[string]healthTarget{}
	for key, l := range links {
		lbl := key
		if l.Label != nil && *l.Label != "" {
			lbl = *l.Label
		}
		targets[key] = healthTarget{url: l.URL, label: lbl}
		for i, e := range l.Extras {
			elbl := e.Label
			if elbl == "" {
				elbl = lbl
			}
			targets[fmt.Sprintf("%s#%d", key, i)] = healthTarget{url: e.URL, label: elbl}
		}
	}

	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup
	for key, tgt := range targets {
		wg.Add(1)
		go func(key string, tgt healthTarget) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			res := probe(ctx, tgt.url)
			var notifyUp *bool
			h.mu.Lock()
			h.results[key] = res
			if res.Up {
				h.failCount[key] = 0
				if h.alerted[key] {
					h.alerted[key] = false
					up := true
					notifyUp = &up
				}
			} else {
				h.failCount[key]++
				if h.failCount[key] >= 3 && !h.alerted[key] {
					h.alerted[key] = true
					up := false
					notifyUp = &up
				}
			}
			h.mu.Unlock()
			if notifyUp != nil && h.onChange != nil {
				h.onChange(key, tgt.label, tgt.url, *notifyUp, res.Status)
			}
		}(key, tgt)
	}
	wg.Wait()

	// Drop results and alert state for links that no longer exist.
	h.mu.Lock()
	for key := range h.results {
		if _, ok := targets[key]; !ok {
			delete(h.results, key)
			delete(h.failCount, key)
			delete(h.alerted, key)
		}
	}
	h.mu.Unlock()
}

// probe GETs u and classifies reachability. Anything that answers HTTP —
// including 401/403/redirect-to-login, which most self-hosted apps return on
// "/" — counts as up; only connection failures and 5xx are down.
func probe(ctx context.Context, u string) healthResult {
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return healthResult{CheckedAt: time.Now().Unix()}
	}
	req.Header.Set("User-Agent", "SuperDash-health-check")
	resp, err := healthClient.Do(req)
	if err != nil {
		return healthResult{CheckedAt: time.Now().Unix()}
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 1024)) //nolint:errcheck — drain for keep-alive, capped
	return healthResult{
		Up:        resp.StatusCode < 500,
		Status:    resp.StatusCode,
		LatencyMS: time.Since(start).Milliseconds(),
		CheckedAt: time.Now().Unix(),
	}
}

// ServiceHealth handles GET /api/service-health — the latest probe result per
// service-link key.
func (s *Server) ServiceHealth(w http.ResponseWriter, r *http.Request) {
	s.health.mu.Lock()
	out := make(map[string]healthResult, len(s.health.results))
	for k, v := range s.health.results {
		out[k] = v
	}
	s.health.mu.Unlock()
	writeJSON(w, http.StatusOK, out)
}
