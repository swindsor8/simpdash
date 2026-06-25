package update

import "testing"

func TestNewer(t *testing.T) {
	cases := []struct {
		cur, lat string
		want     bool
	}{
		{"0.5.2", "0.6.0", true},
		{"v0.5.2", "v0.6.0", true},
		{"0.6.0", "0.6.0", false},
		{"0.6.0", "0.5.9", false},
		{"0.6.0", "0.6.1", true},
		{"1.0", "1.0.1", true},
		{"0.9.9", "1.0.0", true},
		{"dev", "0.6.0", false},             // source build: never nag
		{"0.6.0-3-gabcdef", "0.6.0", false}, // describe suffix ignored, equal
		{"0.6.0", "v1.0.0", true},
		{"0.6.0", "garbage", false},
	}
	for _, c := range cases {
		if got := newer(c.cur, c.lat); got != c.want {
			t.Errorf("newer(%q,%q)=%v want %v", c.cur, c.lat, got, c.want)
		}
	}
}
