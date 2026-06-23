package api

import (
	"testing"
	"time"
)

func TestLimiterLocksOutThenRecovers(t *testing.T) {
	l := newLimiter(3, 50*time.Millisecond)
	const ip = "10.0.0.5"

	// First 3 failures are allowed (each checked before recording).
	for i := 0; i < 3; i++ {
		if !l.allow(ip) {
			t.Fatalf("attempt %d should be allowed", i)
		}
		l.recordFailure(ip)
	}
	// Now locked out.
	if l.allow(ip) {
		t.Fatal("should be locked out after max failures")
	}
	// After the window, allowed again.
	time.Sleep(60 * time.Millisecond)
	if !l.allow(ip) {
		t.Fatal("should be allowed after lockout window")
	}
	// A success clears state entirely.
	l.recordFailure(ip)
	l.reset(ip)
	if len(l.attempts) != 0 {
		t.Fatalf("reset should drop the key, have %d", len(l.attempts))
	}
}
