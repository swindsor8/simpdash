package totp

import (
	"testing"
	"time"
)

// RFC 6238 Appendix B test vectors (SHA-1, 8 digits truncated to our 6 by
// recomputing): use the standard seed and known times, checking our 6-digit
// output against the last 6 digits of the published 8-digit values.
func TestRFC6238Vectors(t *testing.T) {
	// "12345678901234567890" in base32
	secret := "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	cases := []struct {
		unix int64
		want string // last 6 of the RFC's 8-digit codes
	}{
		{59, "287082"},
		{1111111109, "081804"},
		{1111111111, "050471"},
		{1234567890, "005924"},
		{2000000000, "279037"},
	}
	for _, c := range cases {
		got, err := code(secret, uint64(c.unix/30))
		if err != nil {
			t.Fatalf("code: %v", err)
		}
		if got != c.want {
			t.Errorf("t=%d: got %s want %s", c.unix, got, c.want)
		}
	}
}

func TestVerifyWindowAndReplay(t *testing.T) {
	secret, err := NewSecret()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1700000000, 0)
	cur, _ := code(secret, uint64(now.Unix()/30))
	prev, _ := code(secret, uint64(now.Unix()/30)-1)
	next, _ := code(secret, uint64(now.Unix()/30)+1)
	far, _ := code(secret, uint64(now.Unix()/30)+5)

	for _, c := range []string{cur, prev, next} {
		if ok, _ := Verify(secret, c, now); !ok {
			t.Errorf("code %s should verify within ±1 step", c)
		}
	}
	if ok, _ := Verify(secret, far, now); ok {
		t.Error("code 5 steps ahead must not verify")
	}
	if ok, _ := Verify(secret, "000000", now); ok && cur != "000000" && prev != "000000" && next != "000000" {
		t.Error("wrong code verified")
	}
	if ok, _ := Verify(secret, "12345", now); ok {
		t.Error("short code verified")
	}
}
