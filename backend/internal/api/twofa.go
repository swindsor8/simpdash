package api

import (
	"crypto/rand"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"golang.org/x/crypto/bcrypt"

	"simpdash/internal/totp"
)

// TOTP two-factor auth endpoints. Flow:
//
//	POST /api/settings/2fa/setup   → fresh secret + otpauth URI (held in memory,
//	                                 NOT yet active — nothing persists until the
//	                                 admin proves possession of the seed)
//	POST /api/settings/2fa/enable  → {code}: verify against the pending secret;
//	                                 persist + return single-use recovery codes
//	                                 (plaintext exactly once; bcrypt in config)
//	POST /api/settings/2fa/disable → {password, code}: requires BOTH factors to
//	                                 turn 2FA off — a stolen session alone can't
//	                                 silently strip the account
//
// Login (auth.go) requires a valid code (or recovery code) once enabled, with
// anti-replay on the time-step counter and the shared login rate limiter
// covering code guesses.

const recoveryCodeCount = 10

// recoveryAlphabet omits easily-confused characters (0/O, 1/I/L).
const recoveryAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

func newRecoveryCode() (string, error) {
	b := make([]byte, 10)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, 11)
	for i, v := range b {
		p := i
		if i >= 5 {
			p = i + 1
		}
		out[p] = recoveryAlphabet[int(v)%len(recoveryAlphabet)]
	}
	out[5] = '-'
	return string(out), nil
}

// TwoFASetup handles POST /api/settings/2fa/setup.
func (s *Server) TwoFASetup(w http.ResponseWriter, r *http.Request) {
	secret, err := totp.NewSecret()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}
	s.cfgMu.Lock()
	s.pendingTOTP = secret
	s.cfgMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]string{
		"secret":      secret,
		"otpauth_uri": totp.URI(secret, "SuperDash", "admin"),
	})
}

// TwoFAEnable handles POST /api/settings/2fa/enable.
func (s *Server) TwoFAEnable(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" {
		writeErr(w, http.StatusBadRequest, "code required")
		return
	}
	s.cfgMu.Lock()
	pending := s.pendingTOTP
	s.cfgMu.Unlock()
	if pending == "" {
		writeErr(w, http.StatusPreconditionFailed, "run setup first")
		return
	}
	ok, counter := totp.Verify(pending, body.Code, time.Now())
	if !ok {
		writeErr(w, http.StatusBadRequest, "code did not match — check the authenticator app and try again")
		return
	}

	// Generate recovery codes; store only bcrypt hashes.
	codes := make([]string, 0, recoveryCodeCount)
	hashes := make([]string, 0, recoveryCodeCount)
	for i := 0; i < recoveryCodeCount; i++ {
		c, err := newRecoveryCode()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal error")
			return
		}
		h, err := bcrypt.GenerateFromPassword([]byte(c), bcrypt.DefaultCost)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal error")
			return
		}
		codes = append(codes, c)
		hashes = append(hashes, string(h))
	}

	s.cfgMu.Lock()
	s.cfg.TOTPSecret = pending
	s.cfg.TOTPEnabled = true
	s.cfg.RecoveryCodes = hashes
	s.pendingTOTP = ""
	err := s.cfg.Save(s.cfgPath)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save config")
		return
	}
	s.totpMu.Lock()
	s.totpLastUsed = counter // the enrollment code can't be replayed at login
	s.totpMu.Unlock()
	log.Printf("2FA enabled")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "recovery_codes": codes})
}

// TwoFADisable handles POST /api/settings/2fa/disable — requires the password
// AND a current code (or a recovery code), so a hijacked browser session alone
// cannot remove the second factor.
func (s *Server) TwoFADisable(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Password == "" || body.Code == "" {
		writeErr(w, http.StatusBadRequest, "password and code required")
		return
	}
	ip := clientIP(r)
	if !s.loginLimiter.allow(ip) {
		writeErr(w, http.StatusTooManyRequests, "too many attempts, try again shortly")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(s.cfg.PasswordHash), []byte(body.Password)); err != nil {
		s.loginLimiter.recordFailure(ip)
		writeErr(w, http.StatusUnauthorized, "invalid password")
		return
	}
	if !s.cfg.TOTPEnabled {
		writeErr(w, http.StatusPreconditionFailed, "2FA is not enabled")
		return
	}
	if !s.checkSecondFactor(body.Code) {
		s.loginLimiter.recordFailure(ip)
		writeErr(w, http.StatusUnauthorized, "invalid code")
		return
	}
	s.cfgMu.Lock()
	s.cfg.TOTPEnabled = false
	s.cfg.TOTPSecret = ""
	s.cfg.RecoveryCodes = nil
	err := s.cfg.Save(s.cfgPath)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save config")
		return
	}
	log.Printf("2FA disabled")
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// checkSecondFactor validates a TOTP code (with anti-replay) or a single-use
// recovery code (consumed on success).
func (s *Server) checkSecondFactor(code string) bool {
	if ok, counter := totp.Verify(s.cfg.TOTPSecret, code, time.Now()); ok {
		s.totpMu.Lock()
		defer s.totpMu.Unlock()
		if counter <= s.totpLastUsed {
			// Replay of an already-used step — reject. An attacker who shoulder-
			// surfed a code can't reuse it inside the validity window.
			// ponytail: counter is in-memory; a restart forgets it. Window is
			// 90 s — persist to config if that ever matters.
			return false
		}
		s.totpLastUsed = counter
		return true
	}
	// Recovery code path: constant-ish work either way (bcrypt compares).
	s.cfgMu.Lock()
	defer s.cfgMu.Unlock()
	for i, h := range s.cfg.RecoveryCodes {
		if bcrypt.CompareHashAndPassword([]byte(h), []byte(code)) == nil {
			s.cfg.RecoveryCodes = append(s.cfg.RecoveryCodes[:i], s.cfg.RecoveryCodes[i+1:]...)
			if err := s.cfg.Save(s.cfgPath); err != nil {
				log.Printf("consume recovery code: %v", err)
				return false // fail closed: never accept a code we couldn't burn
			}
			log.Printf("recovery code used (%d remaining)", len(s.cfg.RecoveryCodes))
			return true
		}
	}
	return false
}
