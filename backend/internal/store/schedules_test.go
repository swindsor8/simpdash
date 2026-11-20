package store

import (
	"path/filepath"
	"testing"
	"time"
)

func TestSchedulesDBRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "schedules.json")
	db, err := OpenSchedules(path)
	if err != nil {
		t.Fatal(err)
	}

	next := time.Date(2026, 11, 20, 9, 0, 0, 0, time.UTC)
	created, err := db.Create(&Schedule{
		Name:       "Nightly LXC Updates",
		Enabled:    true,
		Action:     "lxc_batch_update",
		TargetType: "all_lxc",
		Node:       "pve",
		Frequency:  "daily",
		TimeOfDay:  "03:00",
		NextRunAt:  &next,
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.ID != 1 {
		t.Fatalf("expected ID 1, got %d", created.ID)
	}

	got, err := db.Get(1)
	if err != nil || got == nil || got.Name != "Nightly LXC Updates" {
		t.Fatalf("Get(1) = %+v, err=%v", got, err)
	}

	updated, err := db.Update(1, func(s *Schedule) {
		s.Enabled = false
		s.RunCount = 3
	})
	if err != nil || updated == nil || updated.Enabled || updated.RunCount != 3 {
		t.Fatalf("Update(1) = %+v, err=%v", updated, err)
	}

	list, err := db.List()
	if err != nil || len(list) != 1 {
		t.Fatalf("List() = %d items, err=%v", len(list), err)
	}

	ok, err := db.Delete(1)
	if err != nil || !ok {
		t.Fatalf("Delete(1) = %v, err=%v", ok, err)
	}
	list, _ = db.List()
	if len(list) != 0 {
		t.Fatalf("expected empty list after delete, got %d", len(list))
	}
}

func TestComputeNextRunFrequencies(t *testing.T) {
	loc := time.FixedZone("CST", -6*3600)
	// Thursday 2026-11-19 20:15 CST
	now := time.Date(2026, 11, 19, 20, 15, 0, 0, loc)

	t.Run("once future", func(t *testing.T) {
		target := time.Date(2026, 11, 20, 3, 0, 0, 0, loc)
		got, err := ComputeNextRun(&Schedule{Frequency: "once", RunAt: &target}, now, loc)
		if err != nil || got == nil || !got.Equal(target) {
			t.Fatalf("got %v, err %v, want %v", got, err, target)
		}
	})

	t.Run("once past returns nil", func(t *testing.T) {
		past := now.Add(-time.Minute)
		got, err := ComputeNextRun(&Schedule{Frequency: "once", RunAt: &past}, now, loc)
		if err != nil || got != nil {
			t.Fatalf("got %v, err %v, want nil", got, err)
		}
	})

	t.Run("hourly", func(t *testing.T) {
		got, err := ComputeNextRun(&Schedule{Frequency: "hourly", Minute: 10}, now, loc)
		want := time.Date(2026, 11, 19, 21, 10, 0, 0, loc)
		if err != nil || got == nil || !got.Equal(want) {
			t.Fatalf("got %v, err %v, want %v", got, err, want)
		}
	})

	t.Run("daily wraps to tomorrow", func(t *testing.T) {
		got, err := ComputeNextRun(&Schedule{Frequency: "daily", TimeOfDay: "03:30"}, now, loc)
		want := time.Date(2026, 11, 20, 3, 30, 0, 0, loc)
		if err != nil || got == nil || !got.Equal(want) {
			t.Fatalf("got %v, err %v, want %v", got, err, want)
		}
	})

	t.Run("weekly picks next matching weekday", func(t *testing.T) {
		// 2026-11-19 is Thursday (4); Sunday is 0 -> 2026-11-22
		got, err := ComputeNextRun(&Schedule{
			Frequency:  "weekly",
			TimeOfDay:  "04:00",
			DaysOfWeek: []int{0, 3}, // Sun, Wed
		}, now, loc)
		want := time.Date(2026, 11, 22, 4, 0, 0, 0, loc)
		if err != nil || got == nil || !got.Equal(want) {
			t.Fatalf("got %v, err %v, want %v", got, err, want)
		}
	})

	t.Run("monthly clamps day 31 in short month", func(t *testing.T) {
		febBase := time.Date(2026, 2, 1, 10, 0, 0, 0, loc)
		got, err := ComputeNextRun(&Schedule{
			Frequency:  "monthly",
			DayOfMonth: 31,
			TimeOfDay:  "02:00",
		}, febBase, loc)
		want := time.Date(2026, 2, 28, 2, 0, 0, 0, loc)
		if err != nil || got == nil || !got.Equal(want) {
			t.Fatalf("got %v, err %v, want %v", got, err, want)
		}
	})

	t.Run("cron expression", func(t *testing.T) {
		got, err := ComputeNextRun(&Schedule{
			Frequency: "cron",
			CronExpr:  "*/30 22 * * *",
		}, now, loc)
		want := time.Date(2026, 11, 19, 22, 0, 0, 0, loc)
		if err != nil || got == nil || !got.Equal(want) {
			t.Fatalf("got %v, err %v, want %v", got, err, want)
		}
	})

	t.Run("cron sunday 7 equals 0", func(t *testing.T) {
		got, err := ComputeNextRun(&Schedule{
			Frequency: "cron",
			CronExpr:  "0 5 * * 7",
		}, now, loc)
		want := time.Date(2026, 11, 22, 5, 0, 0, 0, loc)
		if err != nil || got == nil || !got.Equal(want) {
			t.Fatalf("got %v, err %v, want %v", got, err, want)
		}
	})

	t.Run("invalid cron rejected", func(t *testing.T) {
		if _, err := ComputeNextRun(&Schedule{Frequency: "cron", CronExpr: "bad"}, now, loc); err == nil {
			t.Fatal("expected error for invalid cron")
		}
	})
}
