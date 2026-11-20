package hardware

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"
)

// DriveHealth summarizes SMART health telemetry for one physical storage device.
type DriveHealth struct {
	Device         string `json:"device"`
	Model          string `json:"model,omitempty"`
	Serial         string `json:"serial,omitempty"`
	Protocol       string `json:"protocol,omitempty"`
	CapacityBytes  int64  `json:"capacity_bytes,omitempty"`
	Passed         *bool  `json:"passed,omitempty"`
	TempC          *int   `json:"temp_c,omitempty"`
	PowerOnHours   *int64 `json:"power_on_hours,omitempty"`
	WearPercent    *int   `json:"wear_percent,omitempty"`
	AvailableSpare *int   `json:"available_spare,omitempty"`
	Reallocated    *int64 `json:"reallocated,omitempty"`
	Pending        *int64 `json:"pending,omitempty"`
	Uncorrectable  *int64 `json:"uncorrectable,omitempty"`
	Error          string `json:"error,omitempty"`
}

type smartScanDevice struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// CollectDrives discovers block devices via `smartctl --scan -j` and queries
// each drive's SMART health with bounded concurrency. Returns an explanatory
// note if smartctl is missing or sees no devices.
func CollectDrives(ctx context.Context) ([]DriveHealth, string) {
	scanCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	out, err := exec.CommandContext(scanCtx, "smartctl", "--scan", "-j").Output()
	if err != nil {
		if strings.Contains(err.Error(), "executable file not found") || strings.Contains(err.Error(), "no such file") {
			return []DriveHealth{}, "smartctl not installed — run: apt install -y smartmontools"
		}
		if len(out) == 0 {
			return []DriveHealth{}, "SMART scan unavailable (may require root or direct host disk access)"
		}
	}

	devs, err := ParseSmartScanJSON(out)
	if err != nil {
		return []DriveHealth{}, "could not parse smartctl scan output"
	}
	if len(devs) == 0 {
		return []DriveHealth{}, "No physical disks reported by smartctl"
	}

	results := make([]DriveHealth, len(devs))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for i, d := range devs {
		wg.Add(1)
		go func(idx int, dev smartScanDevice) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			dctx, dcancel := context.WithTimeout(ctx, 10*time.Second)
			defer dcancel()

			args := []string{"-H", "-A", "-i", "-j"}
			if dev.Type != "" && dev.Type != "auto" {
				args = append(args, "-d", dev.Type)
			}
			args = append(args, dev.Name)
			// smartctl uses exit status bits to indicate warnings/prefail even
			// when valid JSON is printed to stdout — always inspect stdout first.
			raw, runErr := exec.CommandContext(dctx, "smartctl", args...).Output()
			if len(raw) > 0 {
				if parsed, perr := ParseSmartJSON(dev.Name, raw); perr == nil {
					results[idx] = parsed
					return
				}
			}
			errMsg := "SMART query failed"
			if runErr != nil {
				errMsg = runErr.Error()
			}
			results[idx] = DriveHealth{Device: dev.Name, Error: errMsg}
		}(i, d)
	}
	wg.Wait()

	// Deduplicate by device path + serial (some controllers list aliases).
	seen := map[string]bool{}
	outDrives := make([]DriveHealth, 0, len(results))
	for _, r := range results {
		key := r.Device
		if r.Serial != "" {
			key = r.Serial
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		outDrives = append(outDrives, r)
	}
	sort.Slice(outDrives, func(i, j int) bool { return outDrives[i].Device < outDrives[j].Device })
	return outDrives, ""
}

// ParseSmartScanJSON parses `smartctl --scan -j` output.
func ParseSmartScanJSON(raw []byte) ([]smartScanDevice, error) {
	var body struct {
		Devices []smartScanDevice `json:"devices"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, err
	}
	out := make([]smartScanDevice, 0, len(body.Devices))
	for _, d := range body.Devices {
		if d.Name == "" {
			continue
		}
		// Skip non-storage pseudo devices if any appear.
		if strings.HasPrefix(d.Name, "/dev/bus/") {
			continue
		}
		out = append(out, d)
	}
	return out, nil
}

// ParseSmartJSON decodes `smartctl -H -A -i -j <dev>` output for NVMe & SATA/SAS drives.
func ParseSmartJSON(dev string, raw []byte) (DriveHealth, error) {
	var body struct {
		Device struct {
			Name     string `json:"name"`
			Protocol string `json:"protocol"`
		} `json:"device"`
		ModelName    string `json:"model_name"`
		ModelFamily  string `json:"model_family"`
		SerialNumber string `json:"serial_number"`
		UserCapacity struct {
			Bytes int64 `json:"bytes"`
		} `json:"user_capacity"`
		SmartStatus *struct {
			Passed bool `json:"passed"`
		} `json:"smart_status"`
		Temperature *struct {
			Current int `json:"current"`
		} `json:"temperature"`
		PowerOnTime *struct {
			Hours int64 `json:"hours"`
		} `json:"power_on_time"`
		NVMeLog *struct {
			Temperature    int   `json:"temperature"`
			PercentageUsed int   `json:"percentage_used"`
			AvailableSpare int   `json:"available_spare"`
			MediaErrors    int64 `json:"media_errors"`
			PowerOnHours   int64 `json:"power_on_hours"`
		} `json:"nvme_smart_health_information_log"`
		ATAAttributes *struct {
			Table []struct {
				ID    int    `json:"id"`
				Name  string `json:"name"`
				Value int    `json:"value"`
				Raw   struct {
					Value int64 `json:"value"`
				} `json:"raw"`
			} `json:"table"`
		} `json:"ata_smart_attributes"`
		Smartctl *struct {
			Messages []struct {
				String   string `json:"string"`
				Severity string `json:"severity"`
			} `json:"messages"`
		} `json:"smartctl"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return DriveHealth{}, err
	}

	d := DriveHealth{
		Device:        dev,
		Model:         strings.TrimSpace(body.ModelName),
		Serial:        strings.TrimSpace(body.SerialNumber),
		Protocol:      strings.TrimSpace(body.Device.Protocol),
		CapacityBytes: body.UserCapacity.Bytes,
	}
	if d.Model == "" {
		d.Model = strings.TrimSpace(body.ModelFamily)
	}
	if body.SmartStatus != nil {
		p := body.SmartStatus.Passed
		d.Passed = &p
	}
	if body.Temperature != nil && body.Temperature.Current > 0 {
		t := body.Temperature.Current
		d.TempC = &t
	}
	if body.PowerOnTime != nil && body.PowerOnTime.Hours >= 0 {
		h := body.PowerOnTime.Hours
		d.PowerOnHours = &h
	}

	if body.NVMeLog != nil {
		if d.Protocol == "" {
			d.Protocol = "NVMe"
		}
		if d.TempC == nil && body.NVMeLog.Temperature > 0 {
			t := body.NVMeLog.Temperature
			d.TempC = &t
		}
		w := body.NVMeLog.PercentageUsed
		d.WearPercent = &w
		sp := body.NVMeLog.AvailableSpare
		d.AvailableSpare = &sp
		me := body.NVMeLog.MediaErrors
		d.Uncorrectable = &me
		if d.PowerOnHours == nil && body.NVMeLog.PowerOnHours > 0 {
			h := body.NVMeLog.PowerOnHours
			d.PowerOnHours = &h
		}
	}

	if body.ATAAttributes != nil {
		for _, attr := range body.ATAAttributes.Table {
			switch attr.ID {
			case 5: // Reallocated_Sector_Ct
				v := attr.Raw.Value
				d.Reallocated = &v
			case 9: // Power_On_Hours
				if d.PowerOnHours == nil {
					v := attr.Raw.Value & 0xFFFFFFFF
					d.PowerOnHours = &v
				}
			case 177, 231, 233: // Wear_Leveling_Count / SSD_Life_Left / Media_Wearout_Indicator
				if d.WearPercent == nil && attr.Value >= 0 && attr.Value <= 100 {
					w := 100 - attr.Value
					d.WearPercent = &w
				}
			case 190, 194: // Airflow_Temperature_Cel / Temperature_Celsius
				if d.TempC == nil {
					// Lower byte often holds current temp when min/max are packed in upper bytes.
					t := int(attr.Raw.Value & 0xFF)
					if t > 0 && t < 150 {
						d.TempC = &t
					}
				}
			case 197: // Current_Pending_Sector
				v := attr.Raw.Value
				d.Pending = &v
			case 198: // Offline_Uncorrectable
				v := attr.Raw.Value
				d.Uncorrectable = &v
			}
		}
	}

	if d.Model == "" && d.Passed == nil && body.Smartctl != nil {
		for _, m := range body.Smartctl.Messages {
			if m.Severity == "error" && m.String != "" {
				d.Error = m.String
				break
			}
		}
		if d.Error == "" {
			return DriveHealth{}, fmt.Errorf("no SMART data for %s", dev)
		}
	}
	return d, nil
}
