package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"simpdash/internal/config"
	"simpdash/internal/notify"
	"simpdash/internal/pbs"
)

// Settings API. Secrets (notify token, PBS secret) are write-only: GET returns
// has_token/has_secret booleans, never the values — a hijacked session can
// reconfigure (visible in the UI) but cannot exfiltrate stored credentials.

// GetSettings handles GET /api/settings.
func (s *Server) GetSettings(w http.ResponseWriter, r *http.Request) {
	s.cfgMu.Lock()
	defer s.cfgMu.Unlock()
	n := s.cfg.Notify
	if n == nil {
		n = &config.NotifyConfig{}
	}
	p := s.cfg.PBS
	if p == nil {
		p = &config.PBSConfig{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"notify": map[string]any{
			"provider":          n.Provider,
			"url":               n.URL,
			"has_token":         n.Token != "",
			"insecure":          n.Insecure,
			"job_failed":        n.JobFailed,
			"node_offline":      n.NodeOffline,
			"updates_available": n.UpdatesAvailable,
			"backup_failed":     n.BackupFailed,
		},
		"pbs": map[string]any{
			"url":         p.URL,
			"token_id":    p.TokenID,
			"has_secret":  p.Secret != "",
			"fingerprint": p.Fingerprint,
		},
		"totp": map[string]any{
			"enabled":        s.cfg.TOTPEnabled,
			"recovery_codes": len(s.cfg.RecoveryCodes),
		},
	})
}

var notifyProviders = map[string]bool{"ntfy": true, "gotify": true, "discord": true, "webhook": true}

// PutNotify handles PUT /api/settings/notify. An empty URL disables
// notifications. Token semantics: omitted/empty keeps the stored token
// (so saving the form doesn't wipe it); the literal "-" clears it.
func (s *Server) PutNotify(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Provider         string  `json:"provider"`
		URL              string  `json:"url"`
		Token            *string `json:"token"`
		Insecure         bool    `json:"insecure"`
		JobFailed        bool    `json:"job_failed"`
		NodeOffline      bool    `json:"node_offline"`
		UpdatesAvailable bool    `json:"updates_available"`
		BackupFailed     bool    `json:"backup_failed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.URL != "" {
		if !notifyProviders[body.Provider] {
			writeErr(w, http.StatusBadRequest, "provider must be ntfy, gotify, discord, or webhook")
			return
		}
		u, err := url.Parse(body.URL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			writeErr(w, http.StatusBadRequest, "url must be a valid http(s):// URL")
			return
		}
	}

	s.cfgMu.Lock()
	prev := ""
	if s.cfg.Notify != nil {
		prev = s.cfg.Notify.Token
	}
	token := prev
	if body.Token != nil {
		token = strings.TrimSpace(*body.Token)
		if token == "-" {
			token = ""
		}
	}
	if body.URL == "" {
		s.cfg.Notify = nil
	} else {
		s.cfg.Notify = &config.NotifyConfig{
			Provider: body.Provider, URL: body.URL, Token: token, Insecure: body.Insecure,
			JobFailed: body.JobFailed, NodeOffline: body.NodeOffline,
			UpdatesAvailable: body.UpdatesAvailable, BackupFailed: body.BackupFailed,
		}
	}
	err := s.cfg.Save(s.cfgPath)
	nc := notifyConfigOf(s.cfg)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save config")
		return
	}
	s.notifier.SetConfig(nc)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// NotifyTest handles POST /api/settings/notify/test.
func (s *Server) NotifyTest(w http.ResponseWriter, r *http.Request) {
	if err := s.notifier.Send("SuperDash test", "Notifications are working."); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// PutPBS handles PUT /api/settings/pbs. Empty URL disables the integration.
// Secret semantics match PutNotify: nil keeps, "-" clears.
func (s *Server) PutPBS(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL         string  `json:"url"`
		TokenID     string  `json:"token_id"`
		Secret      *string `json:"secret"`
		Fingerprint string  `json:"fingerprint"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	s.cfgMu.Lock()
	prev := ""
	if s.cfg.PBS != nil {
		prev = s.cfg.PBS.Secret
	}
	secret := prev
	if body.Secret != nil {
		secret = strings.TrimSpace(*body.Secret)
		if secret == "-" {
			secret = ""
		}
	}
	s.cfgMu.Unlock()

	if body.URL != "" && (body.TokenID == "" || secret == "") {
		writeErr(w, http.StatusBadRequest, "token_id and secret are required")
		return
	}
	// Validate URL/fingerprint by configuring the client first — bad input
	// never reaches the config file.
	if err := s.pbs.SetConfig(body.URL, body.TokenID, secret, body.Fingerprint); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	s.cfgMu.Lock()
	if body.URL == "" {
		s.cfg.PBS = nil
	} else {
		s.cfg.PBS = &config.PBSConfig{URL: body.URL, TokenID: body.TokenID, Secret: secret, Fingerprint: body.Fingerprint}
	}
	err := s.cfg.Save(s.cfgPath)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save config")
		return
	}
	s.pbsCache.mu.Lock()
	s.pbsCache.fetched = time.Time{} // drop stale report from old credentials
	s.pbsCache.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type pbsCache struct {
	mu      sync.Mutex
	data    *pbs.Status
	fetched time.Time
}

// PBSStatus handles GET /api/pbs — datastore usage + per-guest verify state,
// cached 5 min. 204 when the integration isn't configured.
func (s *Server) PBSStatus(w http.ResponseWriter, r *http.Request) {
	if !s.pbs.Configured() {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.pbsCache.mu.Lock()
	defer s.pbsCache.mu.Unlock()
	if s.pbsCache.data == nil || time.Since(s.pbsCache.fetched) > 5*time.Minute {
		st, err := s.pbs.FetchStatus()
		if err != nil {
			if s.pbsCache.data == nil {
				writeErr(w, http.StatusBadGateway, err.Error())
				return
			}
			// serve stale on transient errors
		} else {
			s.pbsCache.data, s.pbsCache.fetched = &st, time.Now()
		}
	}
	writeJSON(w, http.StatusOK, s.pbsCache.data)
}

// notifyConfigOf converts config → notifier config (caller holds cfgMu).
func notifyConfigOf(cfg *config.Config) notify.Config {
	if cfg.Notify == nil {
		return notify.Config{}
	}
	return notify.Config{
		Provider: cfg.Notify.Provider,
		URL:      cfg.Notify.URL,
		Token:    cfg.Notify.Token,
		Insecure: cfg.Notify.Insecure,
	}
}
