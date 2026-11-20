package store

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ParseTimeOfDay parses "HH:MM" (24-hour clock).
func ParseTimeOfDay(s string) (hour, minute int, err error) {
	parts := strings.Split(strings.TrimSpace(s), ":")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("time_of_day must be HH:MM")
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, 0, fmt.Errorf("time_of_day must be HH:MM (00:00–23:59)")
	}
	return h, m, nil
}

// ValidateTiming validates the schedule's frequency and timing fields.
func ValidateTiming(s *Schedule) error {
	switch s.Frequency {
	case "once":
		if s.RunAt == nil || s.RunAt.IsZero() {
			return fmt.Errorf("run_at is required for one-time schedules")
		}
		return nil
	case "hourly":
		if s.Minute < 0 || s.Minute > 59 {
			return fmt.Errorf("minute must be 0–59")
		}
		return nil
	case "daily":
		_, _, err := ParseTimeOfDay(s.TimeOfDay)
		return err
	case "weekly":
		if _, _, err := ParseTimeOfDay(s.TimeOfDay); err != nil {
			return err
		}
		if len(s.DaysOfWeek) == 0 {
			return fmt.Errorf("select at least one day of week")
		}
		for _, d := range s.DaysOfWeek {
			if d < 0 || d > 6 {
				return fmt.Errorf("days_of_week values must be 0 (Sun) through 6 (Sat)")
			}
		}
		return nil
	case "monthly":
		if _, _, err := ParseTimeOfDay(s.TimeOfDay); err != nil {
			return err
		}
		if s.DayOfMonth < 1 || s.DayOfMonth > 31 {
			return fmt.Errorf("day_of_month must be 1–31")
		}
		return nil
	case "cron":
		_, err := parseCron(s.CronExpr)
		return err
	default:
		return fmt.Errorf("frequency must be once, hourly, daily, weekly, monthly, or cron")
	}
}

// ComputeNextRun returns the next execution time strictly after `after`,
// evaluated in `loc` (defaults to time.Local when nil). Returns (nil, nil) for
// a one-time schedule whose RunAt is already <= after.
func ComputeNextRun(s *Schedule, after time.Time, loc *time.Location) (*time.Time, error) {
	if loc == nil {
		loc = time.Local
	}
	base := after.In(loc)

	switch s.Frequency {
	case "once":
		if s.RunAt == nil || s.RunAt.IsZero() {
			return nil, fmt.Errorf("run_at is required for one-time schedules")
		}
		t := s.RunAt.In(loc)
		if !t.After(base) {
			return nil, nil
		}
		u := t.UTC()
		return &u, nil

	case "hourly":
		if s.Minute < 0 || s.Minute > 59 {
			return nil, fmt.Errorf("minute must be 0–59")
		}
		cand := time.Date(base.Year(), base.Month(), base.Day(), base.Hour(), s.Minute, 0, 0, loc)
		if !cand.After(base) {
			cand = cand.Add(time.Hour)
		}
		u := cand.UTC()
		return &u, nil

	case "daily":
		h, m, err := ParseTimeOfDay(s.TimeOfDay)
		if err != nil {
			return nil, err
		}
		cand := time.Date(base.Year(), base.Month(), base.Day(), h, m, 0, 0, loc)
		if !cand.After(base) {
			cand = time.Date(base.Year(), base.Month(), base.Day()+1, h, m, 0, 0, loc)
		}
		u := cand.UTC()
		return &u, nil

	case "weekly":
		h, m, err := ParseTimeOfDay(s.TimeOfDay)
		if err != nil {
			return nil, err
		}
		if len(s.DaysOfWeek) == 0 {
			return nil, fmt.Errorf("select at least one day of week")
		}
		want := map[time.Weekday]bool{}
		for _, d := range s.DaysOfWeek {
			if d < 0 || d > 6 {
				return nil, fmt.Errorf("invalid day_of_week %d", d)
			}
			want[time.Weekday(d)] = true
		}
		for offset := 0; offset <= 7; offset++ {
			day := time.Date(base.Year(), base.Month(), base.Day()+offset, h, m, 0, 0, loc)
			if want[day.Weekday()] && day.After(base) {
				u := day.UTC()
				return &u, nil
			}
		}
		return nil, fmt.Errorf("could not compute next weekly run")

	case "monthly":
		h, m, err := ParseTimeOfDay(s.TimeOfDay)
		if err != nil {
			return nil, err
		}
		if s.DayOfMonth < 1 || s.DayOfMonth > 31 {
			return nil, fmt.Errorf("day_of_month must be 1–31")
		}
		for monthOffset := 0; monthOffset < 24; monthOffset++ {
			first := time.Date(base.Year(), base.Month()+time.Month(monthOffset), 1, 0, 0, 0, 0, loc)
			lastDay := daysInMonth(first.Year(), first.Month(), loc)
			dom := s.DayOfMonth
			if dom > lastDay {
				dom = lastDay // e.g. day 31 in Feb runs on Feb 28/29
			}
			cand := time.Date(first.Year(), first.Month(), dom, h, m, 0, 0, loc)
			if cand.After(base) {
				u := cand.UTC()
				return &u, nil
			}
		}
		return nil, fmt.Errorf("could not compute next monthly run")

	case "cron":
		spec, err := parseCron(s.CronExpr)
		if err != nil {
			return nil, err
		}
		next, ok := spec.next(base)
		if !ok {
			return nil, fmt.Errorf("cron expression has no matching time within 5 years")
		}
		u := next.UTC()
		return &u, nil

	default:
		return nil, fmt.Errorf("unsupported frequency %q", s.Frequency)
	}
}

// PreviewNextRuns computes up to n upcoming run times strictly after `after`.
func PreviewNextRuns(s *Schedule, after time.Time, n int, loc *time.Location) ([]time.Time, error) {
	if err := ValidateTiming(s); err != nil {
		return nil, err
	}
	out := make([]time.Time, 0, n)
	cursor := after
	for len(out) < n {
		next, err := ComputeNextRun(s, cursor, loc)
		if err != nil {
			return nil, err
		}
		if next == nil {
			break
		}
		out = append(out, *next)
		cursor = *next
		if s.Frequency == "once" {
			break
		}
	}
	return out, nil
}

// NormalizeDaysOfWeek deduplicates and sorts days 0..6.
func NormalizeDaysOfWeek(days []int) []int {
	if len(days) == 0 {
		return nil
	}
	seen := map[int]bool{}
	out := make([]int, 0, len(days))
	for _, d := range days {
		if d >= 0 && d <= 6 && !seen[d] {
			seen[d] = true
			out = append(out, d)
		}
	}
	sort.Ints(out)
	return out
}

func daysInMonth(year int, month time.Month, loc *time.Location) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, loc).Day()
}

// --- minimal standard 5-field cron parser (min hour dom mon dow) ---

type cronSpec struct {
	min, hour, dom, mon, dow uint64
	domWild, dowWild         bool
}

func parseCron(expr string) (cronSpec, error) {
	fields := strings.Fields(strings.TrimSpace(expr))
	if len(fields) != 5 {
		return cronSpec{}, fmt.Errorf("cron expression must have 5 fields (minute hour day month weekday)")
	}
	var c cronSpec
	var err error
	if c.min, _, err = parseCronField(fields[0], 0, 59, false); err != nil {
		return c, fmt.Errorf("minute field: %w", err)
	}
	if c.hour, _, err = parseCronField(fields[1], 0, 23, false); err != nil {
		return c, fmt.Errorf("hour field: %w", err)
	}
	if c.dom, c.domWild, err = parseCronField(fields[2], 1, 31, false); err != nil {
		return c, fmt.Errorf("day-of-month field: %w", err)
	}
	if c.mon, _, err = parseCronField(fields[3], 1, 12, false); err != nil {
		return c, fmt.Errorf("month field: %w", err)
	}
	if c.dow, c.dowWild, err = parseCronField(fields[4], 0, 7, true); err != nil {
		return c, fmt.Errorf("day-of-week field: %w", err)
	}
	return c, nil
}

func parseCronField(field string, minVal, maxVal int, wrapSunday bool) (uint64, bool, error) {
	if field == "*" {
		var bits uint64
		hi := maxVal
		if wrapSunday {
			hi = 6
		}
		for i := minVal; i <= hi; i++ {
			bits |= 1 << uint(i)
		}
		return bits, true, nil
	}
	var bits uint64
	for _, part := range strings.Split(field, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			return 0, false, fmt.Errorf("empty item")
		}
		step := 1
		rangePart := part
		if strings.Contains(part, "/") {
			sp := strings.SplitN(part, "/", 2)
			rangePart = sp[0]
			n, err := strconv.Atoi(sp[1])
			if err != nil || n <= 0 {
				return 0, false, fmt.Errorf("invalid step %q", sp[1])
			}
			step = n
		}
		var lo, hi int
		if rangePart == "*" {
			lo, hi = minVal, maxVal
			if wrapSunday {
				hi = 6
			}
		} else if strings.Contains(rangePart, "-") {
			rp := strings.SplitN(rangePart, "-", 2)
			a, err1 := strconv.Atoi(rp[0])
			b, err2 := strconv.Atoi(rp[1])
			if err1 != nil || err2 != nil || a < minVal || b > maxVal || a > b {
				return 0, false, fmt.Errorf("invalid range %q", rangePart)
			}
			lo, hi = a, b
		} else {
			v, err := strconv.Atoi(rangePart)
			if err != nil || v < minVal || v > maxVal {
				return 0, false, fmt.Errorf("invalid value %q", rangePart)
			}
			lo = v
			if strings.Contains(part, "/") {
				hi = maxVal
				if wrapSunday {
					hi = 6
				}
			} else {
				hi = v
			}
		}
		for v := lo; v <= hi; v += step {
			bit := v
			if wrapSunday && bit == 7 {
				bit = 0
			}
			bits |= 1 << uint(bit)
		}
	}
	if bits == 0 {
		return 0, false, fmt.Errorf("matches no values")
	}
	return bits, false, nil
}

func (c cronSpec) matchDay(t time.Time) bool {
	domMatch := (c.dom & (1 << uint(t.Day()))) != 0
	dowMatch := (c.dow & (1 << uint(t.Weekday()))) != 0
	// Standard Vixie cron semantics: when both dom and dow are restricted
	// (neither is '*'), match if EITHER matches; otherwise both must match.
	if !c.domWild && !c.dowWild {
		return domMatch || dowMatch
	}
	return domMatch && dowMatch
}

func (c cronSpec) next(after time.Time) (time.Time, bool) {
	loc := after.Location()
	// Advance to the next whole minute strictly after `after`.
	t := time.Date(after.Year(), after.Month(), after.Day(), after.Hour(), after.Minute()+1, 0, 0, loc)
	limit := t.AddDate(5, 0, 0)

	for t.Before(limit) {
		if (c.mon & (1 << uint(t.Month()))) == 0 {
			t = time.Date(t.Year(), t.Month()+1, 1, 0, 0, 0, 0, loc)
			continue
		}
		if !c.matchDay(t) {
			t = time.Date(t.Year(), t.Month(), t.Day()+1, 0, 0, 0, 0, loc)
			continue
		}
		if (c.hour & (1 << uint(t.Hour()))) == 0 {
			t = time.Date(t.Year(), t.Month(), t.Day(), t.Hour()+1, 0, 0, 0, loc)
			continue
		}
		if (c.min & (1 << uint(t.Minute()))) == 0 {
			t = t.Add(time.Minute)
			continue
		}
		return t, true
	}
	return time.Time{}, false
}
