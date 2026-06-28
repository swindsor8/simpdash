// Notes persist to a separate JSON file from jobs, using the same
// mutex + atomic-write pattern as DB. Single-admin scale, so a full
// read/rewrite per mutation is fine.
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Note is a freeform sticky note, optionally pinned to a node/VM/CT.
type Note struct {
	ID         int64     `json:"id"`
	Content    string    `json:"content"`
	EntityType string    `json:"entity_type,omitempty"` // "node"|"vm"|"lxc"|"" (general)
	EntityID   string    `json:"entity_id,omitempty"`
	Color      string    `json:"color"` // yellow|teal|pink|blue
	Pinned     bool      `json:"pinned"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// EntityCount is the note tally for one linked entity (for tile badges).
type EntityCount struct {
	EntityType string `json:"entity_type"`
	EntityID   string `json:"entity_id"`
	Count      int    `json:"count"`
}

// NotesDB is a mutex-protected flat-file note store (mirrors DB for jobs).
type NotesDB struct {
	path string
	mu   sync.Mutex
}

// OpenNotes opens (or creates) the note store at path.
func OpenNotes(path string) (*NotesDB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db := &NotesDB{path: path}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := db.write([]*Note{}); err != nil {
			return nil, err
		}
	}
	return db, nil
}

// ListNotes returns notes filtered by entity (entityType empty = no entity
// filter) and a case-insensitive content substring q (empty = no search),
// pinned first then newest created_at.
func (s *NotesDB) ListNotes(entityType, entityID, q string) ([]*Note, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	notes, err := s.read()
	if err != nil {
		return nil, err
	}
	q = strings.ToLower(strings.TrimSpace(q))
	out := make([]*Note, 0, len(notes))
	for _, n := range notes {
		if entityType != "" && (n.EntityType != entityType || n.EntityID != entityID) {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(n.Content), q) {
			continue
		}
		out = append(out, n)
	}
	sortNotes(out)
	return out, nil
}

// CreateNote appends a note with a fresh id and returns it.
func (s *NotesDB) CreateNote(content, entityType, entityID, color string) (*Note, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	notes, err := s.read()
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	n := &Note{
		ID:         nextNoteID(notes),
		Content:    content,
		EntityType: entityType,
		EntityID:   entityID,
		Color:      color,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	notes = append(notes, n)
	if err := s.write(notes); err != nil {
		return nil, err
	}
	return n, nil
}

// UpdateNote applies the non-nil fields to note id, bumps updated_at, and
// returns the updated note (nil if not found).
func (s *NotesDB) UpdateNote(id int64, content, color *string, pinned *bool) (*Note, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	notes, err := s.read()
	if err != nil {
		return nil, err
	}
	for _, n := range notes {
		if n.ID == id {
			if content != nil {
				n.Content = *content
			}
			if color != nil {
				n.Color = *color
			}
			if pinned != nil {
				n.Pinned = *pinned
			}
			n.UpdatedAt = time.Now().UTC()
			if err := s.write(notes); err != nil {
				return nil, err
			}
			return n, nil
		}
	}
	return nil, nil
}

// DeleteNote removes note id, reporting whether it existed.
func (s *NotesDB) DeleteNote(id int64) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	notes, err := s.read()
	if err != nil {
		return false, err
	}
	for i, n := range notes {
		if n.ID == id {
			notes = append(notes[:i], notes[i+1:]...)
			return true, s.write(notes)
		}
	}
	return false, nil
}

// Counts tallies notes per linked entity (general notes excluded), in first-seen
// order.
func (s *NotesDB) Counts() ([]EntityCount, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	notes, err := s.read()
	if err != nil {
		return nil, err
	}
	idx := map[string]*EntityCount{}
	order := []string{}
	for _, n := range notes {
		if n.EntityType == "" {
			continue
		}
		key := n.EntityType + ":" + n.EntityID
		if idx[key] == nil {
			idx[key] = &EntityCount{EntityType: n.EntityType, EntityID: n.EntityID}
			order = append(order, key)
		}
		idx[key].Count++
	}
	res := make([]EntityCount, 0, len(order))
	for _, k := range order {
		res = append(res, *idx[k])
	}
	return res, nil
}

// --- internal helpers ---

func sortNotes(notes []*Note) {
	sort.SliceStable(notes, func(i, j int) bool {
		if notes[i].Pinned != notes[j].Pinned {
			return notes[i].Pinned // pinned float to the top
		}
		return notes[i].CreatedAt.After(notes[j].CreatedAt)
	})
}

func nextNoteID(notes []*Note) int64 {
	var hi int64
	for _, n := range notes {
		if n.ID > hi {
			hi = n.ID
		}
	}
	return hi + 1
}

func (s *NotesDB) read() ([]*Note, error) {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return nil, err
	}
	var notes []*Note
	if err := json.Unmarshal(data, &notes); err != nil {
		return nil, err
	}
	return notes, nil
}

func (s *NotesDB) write(notes []*Note) error {
	data, err := json.Marshal(notes)
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
