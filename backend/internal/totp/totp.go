// Package totp implements RFC 6238 time-based one-time passwords with the
// parameters every authenticator app defaults to: SHA-1 HMAC, 6 digits, 30 s
// steps. Stdlib only — no dependency for ~60 lines of well-specified crypto.
package totp

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"time"
)

const (
	digits = 6
	period = 30 // seconds
)

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// NewSecret returns a fresh 160-bit base32 seed (RFC 4226 recommended size).
func NewSecret() (string, error) {
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return b32.EncodeToString(b), nil
}

// URI builds the otpauth:// enrollment URI encoded in QR codes.
func URI(secret, issuer, account string) string {
	return fmt.Sprintf("otpauth://totp/%s:%s?secret=%s&issuer=%s&algorithm=SHA1&digits=%d&period=%d",
		url.PathEscape(issuer), url.PathEscape(account), secret, url.QueryEscape(issuer), digits, period)
}

// code computes the OTP for a specific time step counter.
func code(secret string, counter uint64) (string, error) {
	key, err := b32.DecodeString(secret)
	if err != nil {
		return "", fmt.Errorf("bad secret")
	}
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	v := binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", v%1000000), nil
}

// Verify checks a submitted code against the current time step ±1 (clock
// skew). It returns the matched counter so callers can reject replays by
// remembering the highest counter already used. Comparison is constant-time.
func Verify(secret, submitted string, now time.Time) (matched bool, counter uint64) {
	if len(submitted) != digits {
		return false, 0
	}
	step := uint64(now.Unix() / period)
	for _, c := range []uint64{step, step - 1, step + 1} {
		want, err := code(secret, c)
		if err != nil {
			return false, 0
		}
		if subtle.ConstantTimeCompare([]byte(want), []byte(submitted)) == 1 {
			return true, c
		}
	}
	return false, 0
}
