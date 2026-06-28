package proxmox

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
)

// GuestAction sends a power action to a VM or LXC. guestType is "qemu" or "lxc";
// action is "start", "shutdown", "stop", or "reboot". Returns after Proxmox
// accepts the task (the action is async — state updates appear in the next Fetch).
func (c *Client) GuestAction(node, guestType string, vmid int, action string) error {
	host, tokenID, secret := c.creds()
	if tokenID == "" {
		return fmt.Errorf("proxmox not configured")
	}
	url := fmt.Sprintf("%s/api2/json/nodes/%s/%s/%d/status/%s", host, node, guestType, vmid, action)
	req, err := http.NewRequest(http.MethodPost, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", fmt.Sprintf("PVEAPIToken=%s=%s", tokenID, secret))
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("proxmox returned %s", resp.Status)
	}
	return nil
}

// NodeAction sends a reboot or shutdown command to a PVE node itself.
// Only "reboot" and "shutdown" are valid — nodes cannot be started remotely.
func (c *Client) NodeAction(node, command string) error {
	host, tokenID, secret := c.creds()
	if tokenID == "" {
		return fmt.Errorf("proxmox not configured")
	}
	body, _ := json.Marshal(map[string]string{"command": command})
	url := fmt.Sprintf("%s/api2/json/nodes/%s/status", host, node)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", fmt.Sprintf("PVEAPIToken=%s=%s", tokenID, secret))
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("proxmox returned %s", resp.Status)
	}
	return nil
}
