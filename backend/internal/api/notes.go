package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

const maxNoteLen = 2000

var validNoteColor = map[string]bool{"yellow": true, "teal": true, "pink": true, "blue": true}
var validEntityType = map[string]bool{"node": true, "vm": true, "lxc": true}

// noteBody is the create/update payload. Fields are pointers so an update can
// distinguish "not provided" from "set to empty" (PUT is a partial update).
type noteBody struct {
	Content    *string `json:"content"`
	EntityType *string `json:"entity_type"`
	EntityID   *string `json:"entity_id"`
	Color      *string `json:"color"`
	Pinned     *bool   `json:"pinned"`
}

// handleNotes dispatches GET (list) and POST (create) on /api/notes.
func (s *Server) handleNotes(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.listNotes(w, r)
	case http.MethodPost:
		s.createNote(w, r)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) listNotes(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	et := q.Get("entity_type")
	if et != "" && !validEntityType[et] {
		writeErr(w, http.StatusBadRequest, "invalid entity_type")
		return
	}
	notes, err := s.notes.ListNotes(et, q.Get("entity_id"), q.Get("q"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to read notes")
		return
	}
	writeJSON(w, http.StatusOK, notes)
}

func (s *Server) createNote(w http.ResponseWriter, r *http.Request) {
	var b noteBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if b.Content == nil {
		writeErr(w, http.StatusBadRequest, "content required")
		return
	}
	content := strings.TrimSpace(*b.Content)
	if content == "" {
		writeErr(w, http.StatusBadRequest, "content required")
		return
	}
	if len(content) > maxNoteLen {
		writeErr(w, http.StatusBadRequest, "content too long")
		return
	}

	et, eid := "", ""
	if b.EntityType != nil {
		et = *b.EntityType
	}
	if b.EntityID != nil {
		eid = strings.TrimSpace(*b.EntityID)
	}
	if et != "" && !validEntityType[et] {
		writeErr(w, http.StatusBadRequest, "invalid entity_type")
		return
	}
	if (et == "") != (eid == "") {
		writeErr(w, http.StatusBadRequest, "entity_type and entity_id must be set together")
		return
	}

	color := "yellow"
	if b.Color != nil && *b.Color != "" {
		color = *b.Color
	}
	if !validNoteColor[color] {
		writeErr(w, http.StatusBadRequest, "invalid color")
		return
	}

	n, err := s.notes.CreateNote(content, et, eid, color)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save note")
		return
	}
	writeJSON(w, http.StatusCreated, n)
}

// handleNotesPrefix dispatches PUT/DELETE /api/notes/:id. (/api/notes/counts is
// registered as a more specific exact route, so it never reaches here.)
func (s *Server) handleNotesPrefix(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, "/api/notes/"), 10, 64)
	if err != nil || id <= 0 {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodPut:
		s.updateNote(w, r, id)
	case http.MethodDelete:
		s.deleteNote(w, id)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// updateNote applies content/color/pinned. Entity links are not re-editable in
// v1, so entity_type/entity_id in the body are ignored here.
func (s *Server) updateNote(w http.ResponseWriter, r *http.Request, id int64) {
	var b noteBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if b.Content != nil {
		c := strings.TrimSpace(*b.Content)
		if c == "" {
			writeErr(w, http.StatusBadRequest, "content cannot be empty")
			return
		}
		if len(c) > maxNoteLen {
			writeErr(w, http.StatusBadRequest, "content too long")
			return
		}
		b.Content = &c
	}
	if b.Color != nil && !validNoteColor[*b.Color] {
		writeErr(w, http.StatusBadRequest, "invalid color")
		return
	}
	n, err := s.notes.UpdateNote(id, b.Content, b.Color, b.Pinned)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to update note")
		return
	}
	if n == nil {
		writeErr(w, http.StatusNotFound, "note not found")
		return
	}
	writeJSON(w, http.StatusOK, n)
}

func (s *Server) deleteNote(w http.ResponseWriter, id int64) {
	ok, err := s.notes.DeleteNote(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to delete note")
		return
	}
	if !ok {
		writeErr(w, http.StatusNotFound, "note not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// NotesCounts handles GET /api/notes/counts — note tallies per linked entity,
// for rendering badges on VM/CT tiles without fetching full note content.
func (s *Server) NotesCounts(w http.ResponseWriter, r *http.Request) {
	counts, err := s.notes.Counts()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to read notes")
		return
	}
	writeJSON(w, http.StatusOK, counts)
}
