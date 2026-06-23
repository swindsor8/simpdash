package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"simpdash/internal/api"
	"simpdash/internal/config"
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

	auth := api.NewAuthHandler(cfg, *cfgPath)
	mux := http.NewServeMux()
	// ponytail: method gating lives in each handler (stdlib 1.18 mux has no
	// method patterns) — switch to chi or Go 1.22 routing if this grows.
	mux.HandleFunc("/api/setup/status", methodGate(http.MethodGet, auth.SetupStatus))
	mux.HandleFunc("/api/setup/password", methodGate(http.MethodPost, auth.SetupPassword))
	mux.HandleFunc("/api/auth/login", methodGate(http.MethodPost, auth.Login))
	mux.HandleFunc("/api/auth/logout", methodGate(http.MethodPost, auth.Logout))
	mux.HandleFunc("/api/auth/me", methodGate(http.MethodGet, auth.Me))

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

func methodGate(method string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h(w, r)
	}
}
