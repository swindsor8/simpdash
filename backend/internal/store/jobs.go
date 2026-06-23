// Package store persists job history to a JSON file.
// A mutex serialises all reads and writes; fine for a single-admin tool.
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// DB is a mutex-protected flat-file job store.
type DB struct {
	path string
	mu   sync.Mutex
}

// Job is a job record.
// Output is populated only by GetJob, not ListJobs (can be large).
type Job struct {
	ID         string     `json:"id"`
	Type       string     `json:"type"`
	Status     string     `json:"status"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
	ExitCode   *int       `json:"exit_code,omitempty"`
	Output     string     `json:"output,omitempty"`
}

// Open opens (or creates) the job store at path.
func Open(path string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db := &DB{path: path}
	// Write empty array if the file doesn't exist yet.
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := db.write([]*Job{}); err != nil {
			return nil, err
		}
	}
	return db, nil
}

// CreateJob inserts a new running job record.
func (s *DB) CreateJob(id, jobType string, startedAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	jobs, err := s.read()
	if err != nil {
		return err
	}
	jobs = append(jobs, &Job{
		ID:        id,
		Type:      jobType,
		Status:    "running",
		StartedAt: startedAt.UTC(),
	})
	return s.write(jobs)
}

// FinishJob updates status, exit code, finish time, and captured output.
func (s *DB) FinishJob(id, status string, exitCode int, finishedAt time.Time, output string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	jobs, err := s.read()
	if err != nil {
		return err
	}
	t := finishedAt.UTC()
	for _, j := range jobs {
		if j.ID == id {
			j.Status = status
			j.ExitCode = &exitCode
			j.FinishedAt = &t
			j.Output = output
			break
		}
	}
	return s.write(jobs)
}

// GetJob returns a single job with full output, or nil if not found.
func (s *DB) GetJob(id string) (*Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	jobs, err := s.read()
	if err != nil {
		return nil, err
	}
	for _, j := range jobs {
		if j.ID == id {
			return j, nil
		}
	}
	return nil, nil
}

// ListJobs returns up to 100 most-recent jobs without output.
func (s *DB) ListJobs() ([]*Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	jobs, err := s.read()
	if err != nil {
		return nil, err
	}
	sort.Slice(jobs, func(i, j int) bool {
		return jobs[i].StartedAt.After(jobs[j].StartedAt)
	})
	if len(jobs) > 100 {
		jobs = jobs[:100]
	}
	out := make([]*Job, len(jobs))
	for i, j := range jobs {
		cp := *j
		cp.Output = "" // omit output in list view
		out[i] = &cp
	}
	return out, nil
}

// --- internal helpers ---

func (s *DB) read() ([]*Job, error) {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return nil, err
	}
	var jobs []*Job
	if err := json.Unmarshal(data, &jobs); err != nil {
		return nil, err
	}
	return jobs, nil
}

func (s *DB) write(jobs []*Job) error {
	data, err := json.Marshal(jobs)
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
