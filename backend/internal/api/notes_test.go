package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"simpdash/internal/config"
	"simpdash/internal/store"
)

// End-to-end over the real HTTP routes: auth gate, create (general + entity),
// filter, search, pin ordering, counts, update, delete.
func TestNotesHTTP(t *testing.T) {
	srv := testServer(t, &config.Config{Mode: "main", SessionSecret: "testsecret", Onboarded: true})
	mux := http.NewServeMux()
	srv.Routes(mux)
	ts := httptest.NewServer(mux)
	defer ts.Close()
	cookie := &http.Cookie{Name: cookieName, Value: sessionToken("testsecret")}

	// Auth gate.
	if r, _ := http.Get(ts.URL + "/api/notes"); r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauth list: want 401, got %d", r.StatusCode)
	}

	create := func(body string) *http.Response {
		return postJSON(t, ts.URL+"/api/notes", body, cookie)
	}

	// Create general + two entity-linked notes.
	if r := create(`{"content":"rebooted the host","color":"teal"}`); r.StatusCode != http.StatusCreated {
		t.Fatalf("create general: %d", r.StatusCode)
	}
	var vm store.Note
	r := create(`{"content":"bumped vm 100 ram","entity_type":"vm","entity_id":"100"}`)
	if r.StatusCode != http.StatusCreated {
		t.Fatalf("create entity: %d", r.StatusCode)
	}
	json.NewDecoder(r.Body).Decode(&vm)
	r.Body.Close()
	create(`{"content":"more on vm 100","entity_type":"vm","entity_id":"100"}`).Body.Close()

	// Validation: empty content, bad enum, half-set entity.
	for _, bad := range []string{`{"content":"  "}`, `{"content":"x","entity_type":"bogus","entity_id":"1"}`, `{"content":"x","entity_type":"vm"}`} {
		if r := create(bad); r.StatusCode != http.StatusBadRequest {
			t.Fatalf("want 400 for %s, got %d", bad, r.StatusCode)
		}
	}

	get := func(path string) []store.Note {
		req, _ := http.NewRequest(http.MethodGet, ts.URL+path, nil)
		req.AddCookie(cookie)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		defer resp.Body.Close()
		var out []store.Note
		json.NewDecoder(resp.Body).Decode(&out)
		return out
	}

	if all := get("/api/notes"); len(all) != 3 {
		t.Fatalf("list all: want 3, got %d", len(all))
	}
	if f := get("/api/notes?entity_type=vm&entity_id=100"); len(f) != 2 {
		t.Fatalf("entity filter: want 2, got %d", len(f))
	}
	if s := get("/api/notes?q=REBOOT"); len(s) != 1 {
		t.Fatalf("search: want 1, got %d", len(s))
	}

	// Pin floats to top.
	id := strconv.FormatInt(vm.ID, 10)
	req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/notes/"+id, strings.NewReader(`{"pinned":true}`))
	req.AddCookie(cookie)
	req.Header.Set("Content-Type", "application/json")
	if resp, _ := http.DefaultClient.Do(req); resp.StatusCode != http.StatusOK {
		t.Fatalf("pin: %d", resp.StatusCode)
	}
	if all := get("/api/notes"); all[0].ID != vm.ID || !all[0].Pinned {
		t.Fatalf("pinned note should sort first: %+v", all[0])
	}

	// Counts.
	reqc, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/notes/counts", nil)
	reqc.AddCookie(cookie)
	respc, _ := http.DefaultClient.Do(reqc)
	var counts []store.EntityCount
	json.NewDecoder(respc.Body).Decode(&counts)
	respc.Body.Close()
	if len(counts) != 1 || counts[0].Count != 2 {
		t.Fatalf("counts: %+v", counts)
	}

	// Delete.
	reqd, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/notes/"+id, nil)
	reqd.AddCookie(cookie)
	if resp, _ := http.DefaultClient.Do(reqd); resp.StatusCode != http.StatusOK {
		t.Fatalf("delete: %d", resp.StatusCode)
	}
	if all := get("/api/notes"); len(all) != 2 {
		t.Fatalf("after delete: want 2, got %d", len(all))
	}
}
