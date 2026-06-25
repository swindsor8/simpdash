package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"simpdash/internal/api"
	"simpdash/internal/catalog"
	"simpdash/internal/config"
	"simpdash/internal/executor"
	"simpdash/internal/proxmox"
	"simpdash/internal/store"
	"simpdash/web"
)

func main() {
	cfgPath := flag.String("config", "/etc/homelab-dash/config.yaml", "path to config file")
	flag.Parse()

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	if cfg.SessionSecret == "" {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			log.Fatalf("generate session secret: %v", err)
		}
		cfg.SessionSecret = hex.EncodeToString(b)
		if err := os.MkdirAll(filepath.Dir(*cfgPath), 0700); err != nil {
			log.Fatalf("create config dir: %v", err)
		}
		if err := cfg.Save(*cfgPath); err != nil {
			log.Fatalf("save config: %v", err)
		}
	}

	db, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("open db %s: %v", cfg.DBPath, err)
	}

	px := proxmox.NewClient()
	if cfg.Proxmox != nil && cfg.Proxmox.TokenID != "" {
		px.SetCreds(cfg.Proxmox.Host, cfg.Proxmox.TokenID, cfg.Proxmox.Secret)
	}
	poller := api.NewPoller(px, 3*time.Second)

	cat, err := catalog.Load()
	if err != nil {
		log.Fatalf("load script catalog: %v", err)
	}

	exec := executor.New()
	srv := api.NewServer(cfg, *cfgPath, px, poller, exec, db, cat)
	mux := http.NewServeMux()

	// Secondary (agent) mode: no UI, no sessions — just the bearer-gated agent
	// API and a pairing code advertised until main pairs with this node.
	if cfg.Mode == "secondary" {
		runAgent(srv, mux, cfg, *cfgPath, px)
		return
	}

	go poller.Run(context.Background())
	srv.Routes(mux)

	sub, err := fs.Sub(web.DistFS, "dist")
	if err != nil {
		log.Fatalf("embed sub: %v", err)
	}
	indexHTML, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		log.Fatalf("read embedded index.html (did you run `npm run build`?): %v", err)
	}
	fileServer := http.FileServer(http.FS(sub))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Real asset request (has an extension) → serve from embedded FS.
		// Everything else → index.html, so the React SPA handles routing.
		if path.Ext(r.URL.Path) != "" && !strings.HasPrefix(r.URL.Path, "/api/") {
			fileServer.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(indexHTML) //nolint:errcheck
	})

	log.Printf("SimpDash listening on %s", cfg.ListenAddr)
	log.Fatal(http.ListenAndServe(cfg.ListenAddr, mux))
}

// runAgent serves the secondary-node agent API and blocks. On first boot (not
// yet paired) it advertises a single-use pairing code + this node's address so
// the admin can read it off `systemctl status` / journal and enter it on main.
func runAgent(srv *api.Server, mux *http.ServeMux, cfg *config.Config, cfgPath string, px *proxmox.Client) {
	srv.AgentRoutes(mux)

	// The agent reports this host's own PVE resources, so provision its token
	// the same way main does at onboarding (best-effort; degraded without PVE).
	if cfg.Proxmox == nil || cfg.Proxmox.TokenID == "" {
		if err := proxmox.Provision(cfg, cfgPath); err != nil {
			log.Printf("agent proxmox provisioning failed (resources degraded): %v", err)
		} else if cfg.Proxmox != nil {
			px.SetCreds(cfg.Proxmox.Host, cfg.Proxmox.TokenID, cfg.Proxmox.Secret)
			log.Printf("agent proxmox token provisioned: %s", cfg.Proxmox.TokenID)
		}
	}

	if cfg.AgentToken == "" {
		code := srv.NewPairingCode()
		addr := fmt.Sprintf("%s:%s", detectIP(), portOf(cfg.ListenAddr))
		log.Printf("=========================================================")
		log.Printf("  SECONDARY NODE NOT YET PAIRED")
		log.Printf("  Pairing code:  %s   (valid 15 min, single use)", code)
		log.Printf("  Node address:  %s", addr)
		log.Printf("  On the main SimpDash: Nodes -> Add node, enter the above.")
		log.Printf("=========================================================")
	} else {
		log.Printf("secondary already paired; agent API ready")
	}

	log.Printf("SimpDash agent listening on %s", cfg.ListenAddr)
	log.Fatal(http.ListenAndServe(cfg.ListenAddr, mux))
}

// detectIP returns the host's primary outbound IP (the source address chosen to
// reach the LAN/gateway). No packets are sent — UDP "connect" only picks a route.
func detectIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "127.0.0.1"
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
}

func portOf(listenAddr string) string {
	if _, p, err := net.SplitHostPort(listenAddr); err == nil && p != "" {
		return p
	}
	return "7575"
}
