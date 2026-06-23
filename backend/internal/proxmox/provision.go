package proxmox

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"

	"simpdash/internal/config"
)

// localHost is where SimpDash reaches the PVE API. Main mode runs ON the
// Proxmox host, so the local endpoint is the right default.
const localHost = "https://127.0.0.1:8006"

// privs granted to the SimpDash role — read-only monitoring only.
const privs = "VM.Audit,VM.Monitor,Sys.Audit,Datastore.Audit"

// Provision creates a dedicated read-only Proxmox API token by shelling out to
// pveum, then writes the credentials into cfg and saves. Idempotent for the
// role/user (tolerates "already exists"); the token is created once.
//
// It is a no-op (returns nil) if credentials are already present, so it is safe
// to call on every onboarding. On any pveum failure it returns an error WITHOUT
// mutating cfg — the caller logs it and runs in a degraded "Proxmox
// unavailable" state (e.g. dev machines with no PVE installed).
func Provision(cfg *config.Config, cfgPath string) error {
	if cfg.Proxmox != nil && cfg.Proxmox.TokenID != "" {
		return nil // already provisioned
	}

	// 1. Role (idempotent).
	if err := idempotent(exec.Command("pveum", "role", "add", "SimpDash", "-privs", privs)); err != nil {
		return fmt.Errorf("create role: %w", err)
	}
	// 2. User (idempotent).
	if err := idempotent(exec.Command("pveum", "user", "add", "simpdash@pve")); err != nil {
		return fmt.Errorf("create user: %w", err)
	}
	// 3. Grant the role to the user at the root path. NOT in the original
	// 3-command spec, but required: with --privsep 0 the token inherits the
	// user's privileges, and without this ACL the user (hence token) can read
	// nothing — /cluster/resources comes back empty. Idempotent.
	if err := idempotent(exec.Command("pveum", "acl", "modify", "/", "-user", "simpdash@pve", "-role", "SimpDash")); err != nil {
		return fmt.Errorf("grant acl: %w", err)
	}
	// 4. Token — secret is shown exactly once, so capture it now.
	out, err := exec.Command("pveum", "user", "token", "add", "simpdash@pve", "dashtoken",
		"--privsep", "0", "--output-format", "json").Output()
	if err != nil {
		return fmt.Errorf("create token: %w", stderrOf(err))
	}
	var tok struct {
		Value       string `json:"value"`
		FullTokenID string `json:"full-tokenid"`
	}
	if err := json.Unmarshal(out, &tok); err != nil {
		return fmt.Errorf("parse token output %q: %w", string(out), err)
	}
	if tok.Value == "" || tok.FullTokenID == "" {
		return fmt.Errorf("token output missing value/full-tokenid: %q", string(out))
	}

	cfg.Proxmox = &config.ProxmoxConfig{
		Host:    localHost,
		TokenID: tok.FullTokenID,
		Secret:  tok.Value,
	}
	return cfg.Save(cfgPath)
}

// idempotent runs a pveum command, treating "already exists" as success.
func idempotent(cmd *exec.Cmd) error {
	out, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	if strings.Contains(string(out), "already exists") {
		return nil
	}
	return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
}

// stderrOf enriches an *exec.ExitError with its captured stderr.
func stderrOf(err error) error {
	if ee, ok := err.(*exec.ExitError); ok && len(ee.Stderr) > 0 {
		return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(ee.Stderr)))
	}
	return err
}
