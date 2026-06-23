package api

import (
	"sync"
	"time"
)

// limiter is a tiny per-key failure limiter for the login endpoint: after max
// consecutive failures a key is locked out for window. Brute-force defense on
// top of bcrypt's inherent slowness.
//
// ponytail: in-memory map, no eviction — fine for a single-admin LAN tool
// (few distinct client IPs). If ever exposed to the open internet, add TTL
// eviction or swap for a real limiter; the map could otherwise grow unbounded
// under a spoofed-IP flood (only reachable on the local segment here, since the
// key is the real socket IP, not a spoofable header).
type limiter struct {
	mu       sync.Mutex
	attempts map[string]*attempt
	max      int
	window   time.Duration
}

type attempt struct {
	count int
	until time.Time
}

func newLimiter(max int, window time.Duration) *limiter {
	return &limiter{attempts: map[string]*attempt{}, max: max, window: window}
}

// allow reports whether key is currently permitted to attempt a login.
func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.attempts[key]
	return a == nil || a.until.IsZero() || time.Now().After(a.until)
}

// recordFailure counts a failed attempt and starts a lockout once max is hit.
func (l *limiter) recordFailure(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.attempts[key]
	if a == nil {
		a = &attempt{}
		l.attempts[key] = a
	}
	a.count++
	if a.count >= l.max {
		a.until = time.Now().Add(l.window)
		a.count = 0
	}
}

// reset clears state for key after a successful login.
func (l *limiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempts, key)
}
