// Package notify pushes short event messages (job failed, node offline,
// updates pending…) to a homelab notification service: ntfy, Gotify, a
// Discord webhook, or a generic JSON webhook.
//
// Security posture:
//   - Outbound only; messages carry hostnames/job types, never credentials,
//     session material, or command output.
//   - TLS verification is ON by default (these endpoints are often public,
//     e.g. ntfy.sh); an explicit insecure flag exists for self-signed
//     self-hosted instances.
//   - Tokens are stored in the 0600 config file and never echoed back through
//     the settings API.
package notify

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Config mirrors config.NotifyConfig (kept dependency-free on purpose).
type Config struct {
	Provider string // "ntfy" | "gotify" | "discord" | "webhook"
	URL      string
	Token    string
	Insecure bool
}

// Notifier sends messages using the current config. Config may change at
// runtime via the settings API, so it lives behind a mutex.
type Notifier struct {
	mu  sync.RWMutex
	cfg Config

	client         *http.Client
	insecureClient *http.Client
}

func New(cfg Config) *Notifier {
	return &Notifier{
		cfg:    cfg,
		client: &http.Client{Timeout: 10 * time.Second},
		insecureClient: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		},
	}
}

func (n *Notifier) SetConfig(cfg Config) {
	n.mu.Lock()
	n.cfg = cfg
	n.mu.Unlock()
}

func (n *Notifier) config() Config {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return n.cfg
}

// Enabled reports whether a destination is configured.
func (n *Notifier) Enabled() bool { return n.config().URL != "" }

// Send pushes one message. Returns an error for the settings "test" button;
// event-driven callers log-and-continue (a dead notifier must never break the
// dashboard).
func (n *Notifier) Send(title, message string) error {
	cfg := n.config()
	if cfg.URL == "" {
		return fmt.Errorf("no notification URL configured")
	}
	u, err := url.Parse(cfg.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("notification URL must be http(s)")
	}

	client := n.client
	if cfg.Insecure {
		client = n.insecureClient
	}

	var req *http.Request
	switch cfg.Provider {
	case "ntfy":
		// POST <url> with the message as body; metadata in headers.
		req, err = http.NewRequest(http.MethodPost, cfg.URL, strings.NewReader(message))
		if err != nil {
			return err
		}
		req.Header.Set("Title", title)
		req.Header.Set("Tags", "computer")
		if cfg.Token != "" {
			req.Header.Set("Authorization", "Bearer "+cfg.Token)
		}
	case "gotify":
		// POST <url>/message with the app token.
		body, _ := json.Marshal(map[string]any{"title": title, "message": message, "priority": 5})
		endpoint := strings.TrimRight(cfg.URL, "/") + "/message"
		req, err = http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Gotify-Key", cfg.Token)
	case "discord":
		body, _ := json.Marshal(map[string]string{"content": "**" + title + "**\n" + message})
		req, err = http.NewRequest(http.MethodPost, cfg.URL, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
	default: // generic webhook
		body, _ := json.Marshal(map[string]any{
			"title":   title,
			"message": message,
			"source":  "superdash",
			"ts":      time.Now().Unix(),
		})
		req, err = http.NewRequest(http.MethodPost, cfg.URL, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		if cfg.Token != "" {
			req.Header.Set("Authorization", "Bearer "+cfg.Token)
		}
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("notification endpoint returned %s", resp.Status)
	}
	return nil
}
