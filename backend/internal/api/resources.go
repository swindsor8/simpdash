package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"simpdash/internal/proxmox"
)

// Poller polls Proxmox once every interval and fans the latest snapshot out to
// all subscribed WebSocket clients. One PVE call per tick regardless of how
// many browser tabs are connected.
type Poller struct {
	px       *proxmox.Client
	interval time.Duration

	mu     sync.RWMutex
	latest []byte // last marshaled snapshot, sent to new subscribers immediately
	subs   map[chan []byte]struct{}
}

func NewPoller(px *proxmox.Client, interval time.Duration) *Poller {
	return &Poller{
		px:       px,
		interval: interval,
		subs:     map[chan []byte]struct{}{},
	}
}

// Run polls until ctx is cancelled. Start it once, in a goroutine.
func (p *Poller) Run(ctx context.Context) {
	p.tick() // populate latest immediately so the first subscriber isn't empty
	t := time.NewTicker(p.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			p.tick()
		}
	}
}

func (p *Poller) tick() {
	snap, err := p.px.Fetch()
	if err != nil {
		// Degraded: Proxmox unavailable or not yet provisioned. Emit an empty
		// (but valid) snapshot so the UI shows "no nodes" rather than stalling.
		snap = proxmox.Snapshot{Nodes: []proxmox.Node{}}
	}
	msg, err := json.Marshal(snap)
	if err != nil {
		return
	}
	p.mu.Lock()
	p.latest = msg
	for ch := range p.subs {
		select {
		case ch <- msg:
		default: // slow consumer — drop this frame, never block the poller
		}
	}
	p.mu.Unlock()
}

func (p *Poller) subscribe() chan []byte {
	ch := make(chan []byte, 1)
	p.mu.Lock()
	p.subs[ch] = struct{}{}
	p.mu.Unlock()
	return ch
}

func (p *Poller) unsubscribe(ch chan []byte) {
	p.mu.Lock()
	delete(p.subs, ch)
	p.mu.Unlock()
}

func (p *Poller) snapshot() []byte {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.latest
}

// Resources handles GET /api/resources — one-shot snapshot.
func (s *Server) Resources(w http.ResponseWriter, r *http.Request) {
	snap, err := s.px.Fetch()
	if err != nil {
		snap = proxmox.Snapshot{Nodes: []proxmox.Node{}}
	}
	writeJSON(w, http.StatusOK, snap)
}

var upgrader = websocket.Upgrader{
	// Reject cross-origin WS handshakes (defense-in-depth against Cross-Site
	// WebSocket Hijacking, on top of the SameSite=Strict session cookie). An
	// empty Origin is a non-browser client (e.g. tests) and still has to pass
	// the cookie auth check below, so it's allowed here.
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		u, err := url.Parse(origin)
		return err == nil && u.Host == r.Host
	},
}

// ResourcesStream handles WS /api/resources/stream — pushes the latest snapshot
// on connect, then every poll tick, until the client disconnects.
func (s *Server) ResourcesStream(w http.ResponseWriter, r *http.Request) {
	if !s.validSession(r) {
		writeErr(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // upgrader already wrote the error
	}
	defer conn.Close()

	ch := s.poller.subscribe()
	defer s.poller.unsubscribe(ch)

	// Detect client disconnect: a reader goroutine that closes done on any
	// read error (gorilla requires reading to process close frames).
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	if snap := s.poller.snapshot(); snap != nil {
		if err := conn.WriteMessage(websocket.TextMessage, snap); err != nil {
			return
		}
	}
	for {
		select {
		case <-done:
			return
		case msg := <-ch:
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		}
	}
}
