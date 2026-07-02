package api

import (
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Favicon proxy. The dashboard is often served over HTTPS while linked
// services are plain-HTTP on the LAN — the browser blocks those favicons as
// mixed content, so the backend fetches them instead.
//
// Security posture:
//   - Only URLs already stored by the (session-gated) service-link editor are
//     ever fetched — the client can't pass an arbitrary URL, only a link key,
//     so this is not an open proxy / SSRF oracle.
//   - Responses are size-capped, content-type-gated to images, and served with
//     nosniff + a deny-all CSP so a malicious service can't turn an SVG icon
//     into stored XSS on the dashboard origin.
//   - The fetch sends no cookies or credentials and follows at most 3
//     redirects, each re-validated as http(s).
const (
	iconMaxBytes = 512 * 1024
	iconTTL      = 24 * time.Hour
	iconNegTTL   = time.Hour
)

type iconCache struct {
	mu      sync.Mutex
	entries map[string]iconEntry
}

type iconEntry struct {
	data        []byte // nil = negative cache (fetch failed)
	contentType string
	fetched     time.Time
}

// iconClient skips TLS verification: homelab services are overwhelmingly
// self-signed, and we only read a public image from them (no credentials sent).
var iconClient = &http.Client{
	Timeout: 5 * time.Second,
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return fmt.Errorf("too many redirects")
		}
		if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
			return fmt.Errorf("redirect to non-http scheme")
		}
		return nil
	},
}

// ServiceLinkIcon handles GET /api/service-links/:type/:id/icon — serves the
// linked service's favicon via the backend (mixed-content safe), cached 24h.
func (s *Server) ServiceLinkIcon(w http.ResponseWriter, r *http.Request, key string) {
	links, err := s.serviceLinks.GetAll()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	link, ok := links[key]
	if !ok {
		http.NotFound(w, r)
		return
	}
	u, err := url.Parse(link.URL)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	origin := u.Scheme + "://" + u.Host

	s.icons.mu.Lock()
	if s.icons.entries == nil {
		s.icons.entries = map[string]iconEntry{}
	}
	e, hit := s.icons.entries[origin]
	s.icons.mu.Unlock()

	if hit {
		ttl := iconTTL
		if e.data == nil {
			ttl = iconNegTTL
		}
		if time.Since(e.fetched) < ttl {
			serveIcon(w, e)
			return
		}
	}

	e = fetchIcon(origin)
	s.icons.mu.Lock()
	s.icons.entries[origin] = e
	s.icons.mu.Unlock()
	serveIcon(w, e)
}

func serveIcon(w http.ResponseWriter, e iconEntry) {
	if e.data == nil {
		http.Error(w, "no icon", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", e.contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Write(e.data) //nolint:errcheck
}

func fetchIcon(origin string) iconEntry {
	now := time.Now()
	req, err := http.NewRequest(http.MethodGet, origin+"/favicon.ico", nil)
	if err != nil {
		return iconEntry{fetched: now}
	}
	req.Header.Set("User-Agent", "SuperDash-icon-fetch")
	resp, err := iconClient.Do(req)
	if err != nil {
		return iconEntry{fetched: now}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return iconEntry{fetched: now}
	}
	ct := resp.Header.Get("Content-Type")
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = ct[:i]
	}
	ct = strings.TrimSpace(ct)
	// Some servers mislabel .ico as octet-stream; everything else is rejected —
	// an HTML error page must never be reflected back onto our origin.
	if !strings.HasPrefix(ct, "image/") && ct != "application/octet-stream" {
		return iconEntry{fetched: now}
	}
	if ct == "application/octet-stream" {
		ct = "image/x-icon"
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, iconMaxBytes+1))
	if err != nil || len(data) == 0 || len(data) > iconMaxBytes {
		return iconEntry{fetched: now}
	}
	return iconEntry{data: data, contentType: ct, fetched: now}
}
