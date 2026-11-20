package hardware

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// SensorGroup groups temperature and fan sensors exposed by one hwmon chip.
type SensorGroup struct {
	Chip  string       `json:"chip"`
	Temps []TempSensor `json:"temps,omitempty"`
	Fans  []FanSensor  `json:"fans,omitempty"`
}

// TempSensor is a single temperature reading in degrees Celsius.
type TempSensor struct {
	Label    string   `json:"label"`
	CurrentC float64  `json:"current_c"`
	MaxC     *float64 `json:"max_c,omitempty"`
	CritC    *float64 `json:"crit_c,omitempty"`
}

// FanSensor is a single fan speed reading in RPM.
type FanSensor struct {
	Label string `json:"label"`
	RPM   int    `json:"rpm"`
}

// ReadSensors reads thermal and fan readings from <sysRoot>/class/hwmon,
// falling back to <sysRoot>/class/thermal if no hwmon temperature sensors exist.
func ReadSensors(sysRoot string) []SensorGroup {
	if sysRoot == "" {
		sysRoot = "/sys"
	}
	groups := readHwmon(filepath.Join(sysRoot, "class", "hwmon"))
	hasTemp := false
	for _, g := range groups {
		if len(g.Temps) > 0 {
			hasTemp = true
			break
		}
	}
	if !hasTemp {
		if tz := readThermalZones(filepath.Join(sysRoot, "class", "thermal")); len(tz.Temps) > 0 {
			groups = append(groups, tz)
		}
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].Chip < groups[j].Chip })
	return groups
}

func readHwmon(hwmonDir string) []SensorGroup {
	entries, err := os.ReadDir(hwmonDir)
	if err != nil {
		return nil
	}
	// Merge chips with the same driver name (e.g. multiple nvme controllers get
	// disambiguated by appending a suffix if more than one shares a name).
	type rawGroup struct {
		dir   string
		chip  string
		temps []TempSensor
		fans  []FanSensor
	}
	var raw []rawGroup
	chipCounts := map[string]int{}

	for _, e := range entries {
		dir := filepath.Join(hwmonDir, e.Name())
		chip := readTrimmed(filepath.Join(dir, "name"))
		if chip == "" {
			chip = e.Name()
		}
		temps := readHwmonTemps(dir)
		fans := readHwmonFans(dir)
		if len(temps) == 0 && len(fans) == 0 {
			continue
		}
		chipCounts[chip]++
		raw = append(raw, rawGroup{dir: e.Name(), chip: chip, temps: temps, fans: fans})
	}

	seen := map[string]int{}
	out := make([]SensorGroup, 0, len(raw))
	for _, r := range raw {
		name := r.chip
		if chipCounts[r.chip] > 1 {
			seen[r.chip]++
			name = fmt.Sprintf("%s #%d", r.chip, seen[r.chip])
		}
		out = append(out, SensorGroup{Chip: name, Temps: r.temps, Fans: r.fans})
	}
	return out
}

func readHwmonTemps(dir string) []TempSensor {
	matches, err := filepath.Glob(filepath.Join(dir, "temp*_input"))
	if err != nil || len(matches) == 0 {
		return nil
	}
	sort.Strings(matches)
	out := make([]TempSensor, 0, len(matches))
	for _, path := range matches {
		base := filepath.Base(path)
		prefix := strings.TrimSuffix(base, "_input") // e.g. "temp1"
		cur, ok := readMilliC(path)
		if !ok || cur < -40 || cur > 200 {
			continue
		}
		label := readTrimmed(filepath.Join(dir, prefix+"_label"))
		if label == "" {
			label = prefix
		}
		ts := TempSensor{Label: label, CurrentC: cur}
		if v, ok := readMilliC(filepath.Join(dir, prefix+"_max")); ok && v > 0 && v <= 200 {
			ts.MaxC = &v
		}
		if v, ok := readMilliC(filepath.Join(dir, prefix+"_crit")); ok && v > 0 && v <= 200 {
			ts.CritC = &v
		}
		out = append(out, ts)
	}
	return out
}

func readHwmonFans(dir string) []FanSensor {
	matches, err := filepath.Glob(filepath.Join(dir, "fan*_input"))
	if err != nil || len(matches) == 0 {
		return nil
	}
	sort.Strings(matches)
	out := make([]FanSensor, 0, len(matches))
	for _, path := range matches {
		base := filepath.Base(path)
		prefix := strings.TrimSuffix(base, "_input")
		s := readTrimmed(path)
		rpm, err := strconv.Atoi(s)
		if err != nil || rpm < 0 {
			continue
		}
		label := readTrimmed(filepath.Join(dir, prefix+"_label"))
		if label == "" {
			label = prefix
		}
		out = append(out, FanSensor{Label: label, RPM: rpm})
	}
	return out
}

func readThermalZones(thermalDir string) SensorGroup {
	matches, err := filepath.Glob(filepath.Join(thermalDir, "thermal_zone*"))
	if err != nil || len(matches) == 0 {
		return SensorGroup{}
	}
	sort.Strings(matches)
	g := SensorGroup{Chip: "thermal"}
	for _, dir := range matches {
		cur, ok := readMilliC(filepath.Join(dir, "temp"))
		if !ok || cur < -40 || cur > 200 {
			continue
		}
		label := readTrimmed(filepath.Join(dir, "type"))
		if label == "" {
			label = filepath.Base(dir)
		}
		g.Temps = append(g.Temps, TempSensor{Label: label, CurrentC: cur})
	}
	return g
}

func readMilliC(path string) (float64, bool) {
	s := readTrimmed(path)
	if s == "" {
		return 0, false
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, false
	}
	// Round to 1 decimal place for clean JSON output.
	return math.Round(float64(v)/100.0) / 10.0, true
}

func readTrimmed(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}
