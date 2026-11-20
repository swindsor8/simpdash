package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"simpdash/internal/config"
	"simpdash/internal/notify"
	"simpdash/internal/pbs"
	"simpdash/internal/proxmox"
	"simpdash/internal/store"
)

// Settings API. Secrets (notify token, PBS secret, Proxmox secret) are
// write-only: GET returns has_token/has_secret booleans, never the values — a
// hijacked session can reconfigure (visible in the UI) but cannot exfiltrate
// stored credentials.

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
	px := s.cfg.Proxmox
	if px == nil {
		px = &config.ProxmoxConfig{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"proxmox": map[string]any{
			"host":       px.Host,
			"token_id":   px.TokenID,
			"has_secret": px.Secret != "",
			"local_pve":  proxmox.HasLocalPVE(),
		},
		"notify": map[string]any{
			"provider":          n.Provider,
			"url":               n.URL,
			"has_token":         n.Token != "",
			"insecure":          n.Insecure,
			"job_failed":        n.JobFailed,
			"node_offline":      n.NodeOffline,
			"updates_available": n.UpdatesAvailable,
			"backup_failed":     n.BackupFailed,
			"service_down":      n.ServiceDown,
			"storage_threshold": n.StorageThreshold,
			"backup_stale_days": n.BackupStaleDays,
			"pbs_verify_failed": n.PBSVerifyFailed,
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
		ServiceDown      bool    `json:"service_down"`
		StorageThreshold int     `json:"storage_threshold"`
		BackupStaleDays  int     `json:"backup_stale_days"`
		PBSVerifyFailed  bool    `json:"pbs_verify_failed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.StorageThreshold != 0 && (body.StorageThreshold < 50 || body.StorageThreshold > 99) {
		writeErr(w, http.StatusBadRequest, "storage_threshold must be 0 (off) or between 50 and 99")
		return
	}
	if body.BackupStaleDays != 0 && (body.BackupStaleDays < 1 || body.BackupStaleDays > 365) {
		writeErr(w, http.StatusBadRequest, "backup_stale_days must be 0 (off) or between 1 and 365")
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
			Provider:         body.Provider,
			URL:              body.URL,
			Token:            token,
			Insecure:         body.Insecure,
			JobFailed:        body.JobFailed,
			NodeOffline:      body.NodeOffline,
			UpdatesAvailable: body.UpdatesAvailable,
			BackupFailed:     body.BackupFailed,
			ServiceDown:      body.ServiceDown,
			StorageThreshold: body.StorageThreshold,
			BackupStaleDays:  body.BackupStaleDays,
			PBSVerifyFailed:  body.PBSVerifyFailed,
		}
	}
	err := s.cfg.Save(s.cfgPath)
	nc := notifyConfigOf(s.cfg)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save config")
		return
	}
	if s.notifier != nil {
		s.notifier.SetConfig(nc)
	}
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

// TestPBS handles POST /api/settings/pbs/test — validates the supplied (or
// currently stored) PBS credentials against /status/datastore-usage.
func (s *Server) TestPBS(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL         string  `json:"url"`
		TokenID     string  `json:"token_id"`
		Secret      *string `json:"secret"`
		Fingerprint string  `json:"fingerprint"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}

	s.cfgMu.Lock()
	stored := s.cfg.PBS
	u := strings.TrimRight(strings.TrimSpace(body.URL), "/")
	tokenID := strings.TrimSpace(body.TokenID)
	fp := strings.TrimSpace(body.Fingerprint)
	secret := ""
	if stored != nil {
		if u == "" {
			u = stored.URL
		}
		if tokenID == "" {
			tokenID = stored.TokenID
		}
		if fp == "" {
			fp = stored.Fingerprint
		}
		secret = stored.Secret
	}
	if body.Secret != nil && strings.TrimSpace(*body.Secret) != "" && strings.TrimSpace(*body.Secret) != "-" {
		secret = strings.TrimSpace(*body.Secret)
	}
	s.cfgMu.Unlock()

	if u == "" || tokenID == "" || secret == "" {
		writeErr(w, http.StatusBadRequest, "PBS URL, token ID, and secret are required")
		return
	}

	tmp := pbs.New()
	if err := tmp.SetConfig(u, tokenID, secret, fp); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	st, err := tmp.FetchStatus()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"datastores": len(st.Datastores),
		"guests":     len(st.Guests),
	})
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

// validateProxmoxCreds checks the shape of manual Proxmox VE API credentials.
func validateProxmoxCreds(host, tokenID, secret string) error {
	u, err := url.Parse(host)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errors.New("host must be a valid http(s):// URL (e.g. https://192.168.1.10:8006)")
	}
	if tokenID == "" || !strings.Contains(tokenID, "!") {
		return errors.New("token_id must look like user@realm!tokenname (e.g. simpdash@pve!dashtoken)")
	}
	if secret == "" {
		return errors.New("token secret is required")
	}
	return nil
}

// PutProxmox handles PUT /api/settings/proxmox. Updates the Proxmox VE API
// endpoint and token credentials live (no restart needed). Empty host clears
// the stored credentials. Secret semantics match PutPBS: nil keeps, "-" clears.
func (s *Server) PutProxmox(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Host    string  `json:"host"`
		TokenID string  `json:"token_id"`
		Secret  *string `json:"secret"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	host := strings.TrimRight(strings.TrimSpace(body.Host), "/")
	tokenID := strings.TrimSpace(body.TokenID)

	s.cfgMu.Lock()
	prev := ""
	if s.cfg.Proxmox != nil {
		prev = s.cfg.Proxmox.Secret
	}
	secret := prev
	if body.Secret != nil {
		secret = strings.TrimSpace(*body.Secret)
		if secret == "-" {
			secret = ""
		}
	}
	s.cfgMu.Unlock()

	if host != "" {
		if err := validateProxmoxCreds(host, tokenID, secret); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	s.cfgMu.Lock()
	if host == "" {
		s.cfg.Proxmox = nil
	} else {
		s.cfg.Proxmox = &config.ProxmoxConfig{Host: host, TokenID: tokenID, Secret: secret}
	}
	err := s.cfg.Save(s.cfgPath)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save config")
		return
	}

	if host == "" {
		s.px.SetCreds("", "", "")
	} else {
		s.px.SetCreds(host, tokenID, secret)
	}
	// Drop cached cluster views tied to the old credentials.
	s.backups.mu.Lock()
	s.backups.at = time.Time{}
	s.backups.mu.Unlock()
	s.tasks.mu.Lock()
	s.tasks.fetched = time.Time{}
	s.tasks.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// TestProxmox handles POST /api/settings/proxmox/test — validates the supplied
// (or currently stored) Proxmox API credentials against /cluster/resources.
func (s *Server) TestProxmox(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Host    string  `json:"host"`
		TokenID string  `json:"token_id"`
		Secret  *string `json:"secret"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}

	s.cfgMu.Lock()
	stored := s.cfg.Proxmox
	host := strings.TrimRight(strings.TrimSpace(body.Host), "/")
	tokenID := strings.TrimSpace(body.TokenID)
	secret := ""
	if stored != nil {
		if host == "" {
			host = stored.Host
		}
		if tokenID == "" {
			tokenID = stored.TokenID
		}
		secret = stored.Secret
	}
	if body.Secret != nil && strings.TrimSpace(*body.Secret) != "" {
		secret = strings.TrimSpace(*body.Secret)
	}
	s.cfgMu.Unlock()

	if err := validateProxmoxCreds(host, tokenID, secret); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	nodes, err := proxmox.TestCreds(host, tokenID, secret)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "nodes": nodes})
}

// --- Config export / import (non-secret dashboard data only) ---

type configExportBundle struct {
	Version          int                          `json:"version"`
	ExportedAt       string                       `json:"exported_at"`
	ServiceLinks     map[string]store.ServiceLink `json:"service_links"`
	Notes            []*store.Note                `json:"notes"`
	Schedules        []*store.Schedule            `json:"schedules"`
	LXCUpdateExclude []int                        `json:"lxc_update_exclude"`
}

// ExportConfig handles GET /api/settings/export — exports non-secret dashboard
// state (service links, notes, schedules, LXC excludes). Passwords, TOTP seeds,
// session secrets, and API tokens are deliberately excluded.
func (s *Server) ExportConfig(w http.ResponseWriter, r *http.Request) {
	links := map[string]store.ServiceLink{}
	if s.serviceLinks != nil {
		if m, err := s.serviceLinks.GetAll(); err == nil {
			links = m
		}
	}
	notes := []*store.Note{}
	if s.notes != nil {
		if n, err := s.notes.ListNotes("", "", ""); err == nil {
			notes = n
		}
	}
	scheds := []*store.Schedule{}
	if s.schedules != nil {
		if sc, err := s.schedules.List(); err == nil {
			scheds = sc
		}
	}
	s.cfgMu.Lock()
	excludes := normalizeVMIDs(s.cfg.LXCUpdateExclude)
	s.cfgMu.Unlock()

	bundle := configExportBundle{
		Version:          1,
		ExportedAt:       time.Now().UTC().Format(time.RFC3339),
		ServiceLinks:     links,
		Notes:            notes,
		Schedules:        scheds,
		LXCUpdateExclude: excludes,
	}
	w.Header().Set("Content-Disposition", `attachment; filename="superdash-backup.json"`)
	writeJSON(w, http.StatusOK, bundle)
}

// ImportConfig handles POST /api/settings/import — imports a previously
// exported bundle in "merge" (default) or "replace" mode.
func (s *Server) ImportConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Mode             string                       `json:"mode"` // "merge" | "replace"
		ServiceLinks     map[string]store.ServiceLink `json:"service_links"`
		Notes            []*store.Note                `json:"notes"`
		Schedules        []*store.Schedule            `json:"schedules"`
		LXCUpdateExclude []int                        `json:"lxc_update_exclude"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON backup bundle")
		return
	}
	replace := body.Mode == "replace"
	if body.Mode != "" && body.Mode != "merge" && body.Mode != "replace" {
		writeErr(w, http.StatusBadRequest, "mode must be merge or replace")
		return
	}

	importedLinks := 0
	if s.serviceLinks != nil && body.ServiceLinks != nil {
		clean := map[string]store.ServiceLink{}
		if !replace {
			if existing, err := s.serviceLinks.GetAll(); err == nil {
				for k, v := range existing {
					clean[k] = v
				}
			}
		}
		for k, link := range body.ServiceLinks {
			if !strings.Contains(k, ":") || !validLinkURL(link.URL) {
				continue
			}
			var extras []store.ExtraLink
			for _, ex := range link.Extras {
				if len(extras) >= 8 {
					break
				}
				if validLinkURL(ex.URL) {
					if len(ex.Label) > 64 {
						ex.Label = ex.Label[:64]
					}
					extras = append(extras, ex)
				}
			}
			link.Extras = extras
			clean[k] = link
			importedLinks++
		}
		if err := s.serviceLinks.ReplaceAll(clean); err != nil {
			writeErr(w, http.StatusInternalServerError, "failed to save service links")
			return
		}
		if s.health != nil {
			s.health.wake()
		}
	}

	importedNotes := 0
	if s.notes != nil && body.Notes != nil {
		validColors := map[string]bool{"yellow": true, "teal": true, "pink": true, "blue": true}
		validEntities := map[string]bool{"": true, "node": true, "vm": true, "lxc": true}
		var cleanNotes []*store.Note
		for _, n := range body.Notes {
			if n == nil {
				continue
			}
			content := strings.TrimSpace(n.Content)
			if content == "" || len(content) > 2000 {
				continue
			}
			if !validEntities[n.EntityType] || (n.EntityType == "") != (n.EntityID == "") {
				continue
			}
			color := n.Color
			if !validColors[color] {
				color = "yellow"
			}
			cp := *n
			cp.Content = content
			cp.Color = color
			cleanNotes = append(cleanNotes, &cp)
		}
		var err error
		importedNotes, err = s.notes.Import(cleanNotes, replace)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "failed to save notes")
			return
		}
	}

	importedSchedules := 0
	if s.schedules != nil && body.Schedules != nil {
		loc := time.Local
		if s.scheduler != nil && s.scheduler.loc != nil {
			loc = s.scheduler.loc
		}
		now := time.Now()
		var list []*store.Schedule
		if !replace {
			if existing, err := s.schedules.List(); err == nil {
				list = existing
			}
		}
		for _, sc := range body.Schedules {
			if sc == nil || !validScheduleAction[sc.Action] || !validTargetType[sc.TargetType] {
				continue
			}
			cp := *sc
			cp.LastJobID = ""
			cp.LastRunAt = nil
			cp.LastStatus = ""
			cp.LastError = ""
			cp.RunCount = 0
			if cp.Enabled {
				if next, err := store.ComputeNextRun(&cp, now, loc); err == nil {
					cp.NextRunAt = next
				} else {
					cp.Enabled = false
					cp.NextRunAt = nil
				}
			} else {
				cp.NextRunAt = nil
			}
			list = append(list, &cp)
			importedSchedules++
		}
		if err := s.schedules.ReplaceAll(list); err != nil {
			writeErr(w, http.StatusInternalServerError, "failed to save schedules")
			return
		}
	}

	importedExcludes := 0
	if body.LXCUpdateExclude != nil {
		s.cfgMu.Lock()
		merged := body.LXCUpdateExclude
		if !replace {
			merged = append(append([]int(nil), s.cfg.LXCUpdateExclude...), body.LXCUpdateExclude...)
		}
		clean := normalizeVMIDs(merged)
		s.cfg.LXCUpdateExclude = clean
		err := s.cfg.Save(s.cfgPath)
		s.cfgMu.Unlock()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "failed to save excludes")
			return
		}
		importedExcludes = len(clean)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"imported": map[string]int{
			"service_links":      importedLinks,
			"notes":              importedNotes,
			"schedules":          importedSchedules,
			"lxc_update_exclude": importedExcludes,
		},
	})
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
