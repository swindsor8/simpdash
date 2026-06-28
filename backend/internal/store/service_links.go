package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type ServiceLink struct {
	URL   string  `json:"url"`
	Label *string `json:"label"`
}

type ServiceLinksDB struct {
	path string
	mu   sync.Mutex
}

func OpenServiceLinks(path string) (*ServiceLinksDB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db := &ServiceLinksDB{path: path}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := db.write(map[string]ServiceLink{}); err != nil {
			return nil, err
		}
	}
	return db, nil
}

func (s *ServiceLinksDB) GetAll() (map[string]ServiceLink, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read()
}

func (s *ServiceLinksDB) Upsert(key string, link ServiceLink) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, err := s.read()
	if err != nil {
		return err
	}
	m[key] = link
	return s.write(m)
}

func (s *ServiceLinksDB) Delete(key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, err := s.read()
	if err != nil {
		return err
	}
	delete(m, key)
	return s.write(m)
}

func (s *ServiceLinksDB) read() (map[string]ServiceLink, error) {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return nil, err
	}
	var m map[string]ServiceLink
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	if m == nil {
		m = map[string]ServiceLink{}
	}
	return m, nil
}

func (s *ServiceLinksDB) write(m map[string]ServiceLink) error {
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
