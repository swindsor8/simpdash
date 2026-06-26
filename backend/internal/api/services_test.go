package api

import "testing"

func TestParseServices(t *testing.T) {
	// Real `systemctl list-units --plain --no-legend --state=running` shape:
	// UNIT LOAD ACTIVE SUB DESCRIPTION
	raw := "ssh.service     loaded active running OpenBSD Secure Shell server\n" +
		"cron.service    loaded active running Regular background program processing daemon\n" +
		"\n" + // blank line tolerated
		"short line\n" // too few fields → skipped

	got := parseServices(raw)
	if len(got) != 2 {
		t.Fatalf("want 2 services, got %d: %+v", len(got), got)
	}
	if got[0].Name != "ssh" || got[0].Status != "running" {
		t.Errorf("svc[0] = %+v, want name=ssh status=running", got[0])
	}
	if got[1].Name != "cron" || got[1].Description != "Regular background program processing daemon" {
		t.Errorf("svc[1] = %+v", got[1])
	}
}
