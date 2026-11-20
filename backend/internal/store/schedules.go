// Schedules persist to a flat JSON file (schedules.json) beside jobs.json and
// notes.json, using the same mutex + atomic-write pattern.
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// ScheduleOptions holds action-specific parameters. Only the fields relevant to
// Schedule.Action are populated.
type ScheduleOptions struct {
	// Power action: "start" | "shutdown" | "stop" | "reboot" | "wake"
	PowerAction string `json:"power_action,omitempty"`

	// Backup (vzdump) options:
	Storage  string `json:"storage,omitempty"`
	Mode     string `json:"mode,omitempty"`     // "snapshot" (default) | "suspend" | "stop"
	Compress string `json:"compress,omitempty"` // "zstd" (default) | "gzip" | "lzo" | "0"
	Notes    string `json:"notes,omitempty"`

	// Snapshot options:
	SnapshotName string `json:"snapshot_name,omitempty"`
	IncludeRAM   bool   `json:"include_ram,omitempty"`

	// Batch LXC update options:
	Exclude         []int `json:"exclude"`
	ContinueOnError *bool `json:"continue_on_error,omitempty"`
}

// Schedule represents a one-time or recurring scheduled task.
type Schedule struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`

	// Action: "host_update" | "ct_update" | "lxc_batch_update" |
	//         "backup" | "snapshot" | "power" | "speedtest"
	Action string `json:"action"`

	// Target:
	//   TargetType: "node" | "lxc" | "qemu" | "all_lxc" | "all_guests"
	TargetType   string `json:"target_type"`
	Node         string `json:"node,omitempty"`
	PairedNodeID string `json:"paired_node_id,omitempty"`
	VMID         int    `json:"vmid,omitempty"`
	GuestName    string `json:"guest_name,omitempty"`

	Options ScheduleOptions `json:"options,omitempty"`

	// Timing:
	//   Frequency: "once" | "hourly" | "daily" | "weekly" | "monthly" | "cron"
	Frequency  string     `json:"frequency"`
	RunAt      *time.Time `json:"run_at,omitempty"`
	TimeOfDay  string     `json:"time_of_day,omitempty"` // "HH:MM" (24h, server local TZ)
	Minute     int        `json:"minute,omitempty"`      // 0..59 for hourly
	DaysOfWeek []int      `json:"days_of_week,omitempty"`
	DayOfMonth int        `json:"day_of_month,omitempty"`
	CronExpr   string     `json:"cron_expr,omitempty"`

	// Execution & notification policy:
	IfBusy string `json:"if_busy,omitempty"` // "queue" (default) | "skip"
	Notify string `json:"notify,omitempty"`  // "failure" (default) | "always" | "never"

	// Runtime state:
	NextRunAt  *time.Time `json:"next_run_at,omitempty"`
	LastRunAt  *time.Time `json:"last_run_at,omitempty"`
	LastStatus string     `json:"last_status,omitempty"` // "queued"|"running"|"succeeded"|"failed"|"skipped"|"missed"
	LastError  string     `json:"last_error,omitempty"`
	LastJobID  string     `json:"last_job_id,omitempty"`
	RunCount   int        `json:"run_count"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// SchedulesDB is a mutex-protected flat-file schedule store.
type SchedulesDB struct {
	path string
	mu   sync.Mutex
}

// OpenSchedules opens (or creates) the schedule store at path.
func OpenSchedules(path string) (*SchedulesDB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db := &SchedulesDB{path: path}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := db.write([]*Schedule{}); err != nil {
			return nil, err
		}
	}
	return db, nil
}

// List returns all schedules sorted by enabled first, then soonest NextRunAt,
// then ID ascending.
func (s *SchedulesDB) List() ([]*Schedule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	list, err := s.read()
	if err != nil {
		return nil, err
	}
	sortSchedules(list)
	out := make([]*Schedule, len(list))
	for i, item := range list {
		out[i] = cloneSchedule(item)
	}
	return out, nil
}

// Get returns a single schedule by ID, or nil if not found.
func (s *SchedulesDB) Get(id int64) (*Schedule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	list, err := s.read()
	if err != nil {
		return nil, err
	}
	for _, item := range list {
		if item.ID == id {
			return cloneSchedule(item), nil
		}
	}
	return nil, nil
}

// Create assigns a new ID and timestamps, persists, and returns a copy.
func (s *SchedulesDB) Create(item *Schedule) (*Schedule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	list, err := s.read()
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	cp := cloneSchedule(item)
	cp.ID = nextScheduleID(list)
	cp.CreatedAt = now
	cp.UpdatedAt = now
	list = append(list, cp)
	if err := s.write(list); err != nil {
		return nil, err
	}
	return cloneSchedule(cp), nil
}

// Update replaces a schedule by ID using fn (run under the store lock), bumps
// UpdatedAt, persists, and returns the updated copy (or nil if not found).
func (s *SchedulesDB) Update(id int64, fn func(*Schedule)) (*Schedule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	list, err := s.read()
	if err != nil {
		return nil, err
	}
	for _, item := range list {
		if item.ID == id {
			fn(item)
			item.UpdatedAt = time.Now().UTC()
			if err := s.write(list); err != nil {
				return nil, err
			}
			return cloneSchedule(item), nil
		}
	}
	return nil, nil
}

// Delete removes schedule id, reporting whether it existed.
func (s *SchedulesDB) Delete(id int64) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	list, err := s.read()
	if err != nil {
		return false, err
	}
	for i, item := range list {
		if item.ID == id {
			list = append(list[:i], list[i+1:]...)
			return true, s.write(list)
		}
	}
	return false, nil
}

// ReplaceAll replaces all persisted schedules (used by config import).
func (s *SchedulesDB) ReplaceAll(incoming []*Schedule) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Schedule, 0, len(incoming))
	now := time.Now().UTC()
	for _, in := range incoming {
		if in == nil {
			continue
		}
		cp := cloneSchedule(in)
		cp.ID = nextScheduleID(out)
		if cp.CreatedAt.IsZero() {
			cp.CreatedAt = now
		}
		cp.UpdatedAt = now
		out = append(out, cp)
	}
	return s.write(out)
}

// --- internal helpers ---

func sortSchedules(list []*Schedule) {
	sort.SliceStable(list, func(i, j int) bool {
		a, b := list[i], list[j]
		if a.Enabled != b.Enabled {
			return a.Enabled
		}
		if a.NextRunAt != nil && b.NextRunAt != nil {
			if !a.NextRunAt.Equal(*b.NextRunAt) {
				return a.NextRunAt.Before(*b.NextRunAt)
			}
		} else if (a.NextRunAt != nil) != (b.NextRunAt != nil) {
			return a.NextRunAt != nil
		}
		return a.ID < b.ID
	})
}

func nextScheduleID(list []*Schedule) int64 {
	var hi int64
	for _, item := range list {
		if item.ID > hi {
			hi = item.ID
		}
	}
	return hi + 1
}

func cloneSchedule(in *Schedule) *Schedule {
	if in == nil {
		return nil
	}
	cp := *in
	if in.DaysOfWeek != nil {
		cp.DaysOfWeek = append([]int(nil), in.DaysOfWeek...)
	}
	if in.Options.Exclude != nil {
		cp.Options.Exclude = append([]int(nil), in.Options.Exclude...)
	}
	if in.Options.ContinueOnError != nil {
		v := *in.Options.ContinueOnError
		cp.Options.ContinueOnError = &v
	}
	if in.RunAt != nil {
		t := *in.RunAt
		cp.RunAt = &t
	}
	if in.NextRunAt != nil {
		t := *in.NextRunAt
		cp.NextRunAt = &t
	}
	if in.LastRunAt != nil {
		t := *in.LastRunAt
		cp.LastRunAt = &t
	}
	return &cp
}

func (s *SchedulesDB) read() ([]*Schedule, error) {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return nil, err
	}
	var list []*Schedule
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, err
	}
	if list == nil {
		list = []*Schedule{}
	}
	return list, nil
}

func (s *SchedulesDB) write(list []*Schedule) error {
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
