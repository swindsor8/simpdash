package hardware

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadSensorsHwmon(t *testing.T) {
	root := t.TempDir()
	h0 := filepath.Join(root, "class", "hwmon", "hwmon0")
	if err := os.MkdirAll(h0, 0755); err != nil {
		t.Fatal(err)
	}
	mustWrite := func(p, v string) {
		t.Helper()
		if err := os.WriteFile(p, []byte(v), 0644); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite(filepath.Join(h0, "name"), "coretemp\n")
	mustWrite(filepath.Join(h0, "temp1_label"), "Package id 0\n")
	mustWrite(filepath.Join(h0, "temp1_input"), "52500\n")
	mustWrite(filepath.Join(h0, "temp1_max"), "80000\n")
	mustWrite(filepath.Join(h0, "temp1_crit"), "100000\n")
	mustWrite(filepath.Join(h0, "fan1_label"), "CPU Fan\n")
	mustWrite(filepath.Join(h0, "fan1_input"), "1450\n")

	groups := ReadSensors(root)
	if len(groups) != 1 {
		t.Fatalf("got %d sensor groups, want 1", len(groups))
	}
	g := groups[0]
	if g.Chip != "coretemp" {
		t.Errorf("chip = %q, want coretemp", g.Chip)
	}
	if len(g.Temps) != 1 || g.Temps[0].CurrentC != 52.5 || g.Temps[0].Label != "Package id 0" {
		t.Fatalf("unexpected temps: %+v", g.Temps)
	}
	if g.Temps[0].CritC == nil || *g.Temps[0].CritC != 100.0 {
		t.Errorf("crit = %v, want 100", g.Temps[0].CritC)
	}
	if len(g.Fans) != 1 || g.Fans[0].RPM != 1450 {
		t.Fatalf("unexpected fans: %+v", g.Fans)
	}
}

func TestReadSensorsThermalFallback(t *testing.T) {
	root := t.TempDir()
	tz := filepath.Join(root, "class", "thermal", "thermal_zone0")
	if err := os.MkdirAll(tz, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(tz, "type"), []byte("x86_pkg_temp\n"), 0644)
	_ = os.WriteFile(filepath.Join(tz, "temp"), []byte("47000\n"), 0644)

	groups := ReadSensors(root)
	if len(groups) != 1 || groups[0].Chip != "thermal" || len(groups[0].Temps) != 1 || groups[0].Temps[0].CurrentC != 47.0 {
		t.Fatalf("unexpected fallback groups: %+v", groups)
	}
}

func TestParseSmartNVMeAndSATA(t *testing.T) {
	nvmeRaw := []byte(`{
		"device": {"name": "/dev/nvme0", "protocol": "NVMe"},
		"model_name": "Samsung SSD 980 PRO 1TB",
		"serial_number": "S5GX1234",
		"user_capacity": {"bytes": 1000204886016},
		"smart_status": {"passed": true},
		"temperature": {"current": 41},
		"power_on_time": {"hours": 1234},
		"nvme_smart_health_information_log": {
			"temperature": 41,
			"percentage_used": 3,
			"available_spare": 100,
			"media_errors": 0,
			"power_on_hours": 1234
		}
	}`)
	d, err := ParseSmartJSON("/dev/nvme0", nvmeRaw)
	if err != nil {
		t.Fatalf("parse nvme: %v", err)
	}
	if d.Passed == nil || !*d.Passed || d.WearPercent == nil || *d.WearPercent != 3 || d.TempC == nil || *d.TempC != 41 {
		t.Fatalf("unexpected nvme drive: %+v", d)
	}

	sataRaw := []byte(`{
		"device": {"name": "/dev/sda", "protocol": "ATA"},
		"model_name": "WDC WD40EFAX",
		"serial_number": "WD-ABC",
		"user_capacity": {"bytes": 4000787030016},
		"smart_status": {"passed": false},
		"ata_smart_attributes": {
			"table": [
				{"id": 5, "name": "Reallocated_Sector_Ct", "value": 100, "raw": {"value": 4}},
				{"id": 9, "name": "Power_On_Hours", "value": 90, "raw": {"value": 8500}},
				{"id": 194, "name": "Temperature_Celsius", "value": 110, "raw": {"value": 36}},
				{"id": 197, "name": "Current_Pending_Sector", "value": 100, "raw": {"value": 1}}
			]
		}
	}`)
	s, err := ParseSmartJSON("/dev/sda", sataRaw)
	if err != nil {
		t.Fatalf("parse sata: %v", err)
	}
	if s.Passed == nil || *s.Passed {
		t.Fatalf("expected failed smart status: %+v", s)
	}
	if s.Reallocated == nil || *s.Reallocated != 4 || s.Pending == nil || *s.Pending != 1 || s.TempC == nil || *s.TempC != 36 {
		t.Fatalf("unexpected sata attrs: %+v", s)
	}
}

func TestParseZFS(t *testing.T) {
	listOut := "rpool\t1000000000000\t400000000000\t600000000000\t40\t12\tONLINE\n" +
		"tank\t4000000000000\t3500000000000\t500000000000\t87\t25\tDEGRADED\n"
	pools := ParseZpoolList(listOut)
	if len(pools) != 2 {
		t.Fatalf("got %d pools, want 2", len(pools))
	}
	if pools[0].Name != "rpool" || pools[0].CapPct != 40 || pools[1].Health != "DEGRADED" {
		t.Fatalf("unexpected pools: %+v", pools)
	}

	statusOut := `  pool: tank
 state: DEGRADED
  scan: scrub repaired 0B in 01:12:00 with 0 errors on Sun Nov 10 02:00:00 2026
config:

	NAME        STATE     READ WRITE CKSUM
	tank        DEGRADED     0     0     0
	  mirror-0  DEGRADED     0     0     0
	    sda     ONLINE       0     0     0
	    sdb     FAULTED      3     1     0

errors: No known data errors
`
	st := ParseZpoolStatus(statusOut)
	info, ok := st["tank"]
	if !ok {
		t.Fatal("missing tank in status map")
	}
	if info.errors != "No known data errors" {
		t.Errorf("errors = %q", info.errors)
	}
	if len(info.vdevs) != 4 {
		t.Fatalf("got %d vdevs, want 4: %+v", len(info.vdevs), info.vdevs)
	}
	if info.vdevs[3].Name != "sdb" || info.vdevs[3].Read != 3 || info.vdevs[3].Write != 1 {
		t.Errorf("unexpected faulty vdev: %+v", info.vdevs[3])
	}
}
