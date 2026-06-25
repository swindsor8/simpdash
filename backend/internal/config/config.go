// Package config loads and saves the application configuration from a YAML file.
// The default path is /etc/homelab-dash/config.yaml, overridable with --config.
//
// Field docs:
//
//	Mode          — "main" (serves the dashboard UI) or "secondary" (agent-only, no UI).
//	               Set at install time by install.sh; not changed at runtime.
//
//	ListenAddr    — TCP address the HTTP server binds to. Default ":7575".
//
//	Onboarded     — false until the admin sets a password via POST /api/setup/password.
//	               The UI shows the onboarding wizard when false.
//
//	PasswordHash  — bcrypt hash of the admin password. Empty until first setup.
//
//	SessionSecret — HMAC key for signing session cookies. Generated on first run
//	               if empty. Rotating it invalidates all active sessions.
//
//	Proxmox       — Proxmox API credentials. Auto-provisioned in Milestone 2.
//
//	PairedNodes   — Secondary nodes that have completed pairing (Milestone 5).
package config

import (
	"errors"
	"os"

	"gopkg.in/yaml.v3"
)

// Config is the top-level configuration for SimpDash.
type Config struct {
	Mode          string         `yaml:"mode"`
	ListenAddr    string         `yaml:"listen_addr"`
	DBPath        string         `yaml:"db_path"`
	Onboarded     bool           `yaml:"onboarded"`
	PasswordHash  string         `yaml:"password_hash,omitempty"`
	SessionSecret string         `yaml:"session_secret,omitempty"`
	Proxmox       *ProxmoxConfig `yaml:"proxmox,omitempty"`
	PairedNodes   []PairedNode   `yaml:"paired_nodes,omitempty"`

	// AgentToken is the permanent bearer credential a secondary issues to main
	// on pairing (Milestone 5). Empty until paired; once set, the agent is paired
	// and stops advertising a pairing code. Secondary mode only.
	AgentToken string `yaml:"agent_token,omitempty"`
}

// ProxmoxConfig holds Proxmox VE API credentials (populated in Milestone 2).
type ProxmoxConfig struct {
	// Host is the base URL, e.g. "https://192.168.1.10:8006".
	Host string `yaml:"host,omitempty"`
	// TokenID is the API token identifier, e.g. "root@pam!simpdash".
	TokenID string `yaml:"token_id,omitempty"`
	// Secret is the API token secret UUID.
	Secret string `yaml:"secret,omitempty"`
}

// PairedNode is a secondary agent that has completed the pairing handshake (Milestone 5).
type PairedNode struct {
	ID        string `yaml:"id"`
	Address   string `yaml:"address"`
	AuthToken string `yaml:"auth_token"`
}

func defaults() *Config {
	return &Config{
		Mode:       "main",
		ListenAddr: ":7575",
		DBPath:     "/etc/homelab-dash/simpdash.db",
	}
}

// Load reads the config from path. Returns defaults (no error) if the file
// does not exist, so the caller can populate and save on first run.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return defaults(), nil
	}
	if err != nil {
		return nil, err
	}
	cfg := defaults()
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

// Save writes cfg to path atomically (temp file + rename) with 0600 permissions.
func (c *Config) Save(path string) error {
	data, err := yaml.Marshal(c)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
