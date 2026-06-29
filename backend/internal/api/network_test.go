package api

import (
	"strings"
	"testing"
)

func TestParseNetDev(t *testing.T) {
	// Two header lines, then one interface. Columns:
	// rx: bytes packets errs drop fifo frame compressed multicast
	// tx: bytes packets errs drop fifo colls carrier compressed
	sample := `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
  eth0: 1000 10 2 3 0 0 0 0 2000 20 4 5 0 0 0 0`
	got := parseNetDev(strings.NewReader(sample))
	s, ok := got["eth0"]
	if !ok {
		t.Fatal("eth0 not parsed")
	}
	if s.RxBytes != 1000 || s.RxPackets != 10 || s.RxErrs != 2 || s.RxDrop != 3 {
		t.Errorf("rx wrong: %+v", s)
	}
	if s.TxBytes != 2000 || s.TxPackets != 20 || s.TxErrs != 4 || s.TxDrop != 5 {
		t.Errorf("tx wrong: %+v", s)
	}
}

func TestDefaultGatewayParse(t *testing.T) {
	// Mirrors the parse in defaultGateway() against canonical `ip route` output.
	line := "default via 10.0.0.1 dev vmbr0 proto kernel"
	fields := strings.Fields(line)
	var gw string
	for i, f := range fields {
		if f == "via" && i+1 < len(fields) {
			gw = fields[i+1]
		}
	}
	if gw != "10.0.0.1" {
		t.Errorf("gateway = %q, want 10.0.0.1", gw)
	}
}
