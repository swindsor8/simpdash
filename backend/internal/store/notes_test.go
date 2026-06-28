package store

import (
	"path/filepath"
	"testing"
)

func TestNotesCRUDFilterCounts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.json")
	db, err := OpenNotes(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	// Create: general + two entity-linked notes.
	gen, _ := db.CreateNote("rebooted the host", "", "", "yellow")
	vm, _ := db.CreateNote("bumped vm 100 ram", "vm", "100", "teal")
	if _, err := db.CreateNote("more on vm 100", "vm", "100", "blue"); err != nil {
		t.Fatalf("create: %v", err)
	}
	if gen.ID == vm.ID {
		t.Fatalf("ids not unique: %d", gen.ID)
	}

	// Entity filter.
	got, _ := db.ListNotes("vm", "100", "")
	if len(got) != 2 {
		t.Fatalf("entity filter: want 2, got %d", len(got))
	}
	// Text search (case-insensitive).
	got, _ = db.ListNotes("", "", "REBOOT")
	if len(got) != 1 || got[0].ID != gen.ID {
		t.Fatalf("search: want general note, got %v", got)
	}

	// Pin floats to the top regardless of create order.
	if _, err := db.UpdateNote(vm.ID, nil, nil, ptrBool(true)); err != nil {
		t.Fatalf("pin: %v", err)
	}
	all, _ := db.ListNotes("", "", "")
	if len(all) != 3 || all[0].ID != vm.ID {
		t.Fatalf("pinned note should sort first, got %v", all)
	}

	// Counts: only entity-linked notes, tallied per entity.
	counts, _ := db.Counts()
	if len(counts) != 1 || counts[0].EntityType != "vm" || counts[0].EntityID != "100" || counts[0].Count != 2 {
		t.Fatalf("counts: %+v", counts)
	}

	// Update content; delete.
	if _, err := db.UpdateNote(gen.ID, ptrStr("edited"), nil, nil); err != nil {
		t.Fatalf("update: %v", err)
	}
	ok, _ := db.DeleteNote(gen.ID)
	if !ok {
		t.Fatal("delete reported not found")
	}
	if miss, _ := db.DeleteNote(gen.ID); miss {
		t.Fatal("second delete should report not found")
	}

	// Persistence: reopen the same file, edited content survives.
	db2, err := OpenNotes(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	all, _ = db2.ListNotes("", "", "")
	if len(all) != 2 {
		t.Fatalf("after reopen want 2, got %d", len(all))
	}
}

func ptrStr(s string) *string { return &s }
func ptrBool(b bool) *bool    { return &b }
