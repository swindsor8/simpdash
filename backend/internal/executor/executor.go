// Package executor runs privileged subprocesses, streams output line-by-line
// to WebSocket subscribers, and persists completed jobs to SQLite.
//
// Exactly one job may run at a time. The lock is enforced here, not at the
// UI — a UI disable is a nicety on top, not the real guard.
package executor

import (
	"bufio"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"

	"simpdash/internal/store"
)

// ErrBusy is returned by Start when a job is already running.
var ErrBusy = errors.New("a job is already running")

// Executor manages a single running job slot.
type Executor struct {
	mu      sync.Mutex
	current *activeJob
}

type activeJob struct {
	id      string
	jobType string

	// mu protects lines, subs, and ptmx. Never held while e.mu is held.
	mu    sync.Mutex
	done  bool     // set before channels are closed; Subscribe checks this
	lines []string // accumulated JSON output lines (including the final "done" line)
	subs  []chan string
	ptmx  *os.File // PTY master for interactive jobs; nil for pipe-based jobs. Input() writes here.
}

// New returns a ready Executor.
func New() *Executor { return &Executor{} }

// Start launches cmd as a background job of type jobType. It returns the job
// ID immediately — callers must use /api/jobs/:id/stream to follow output.
//
// Returns ErrBusy if a job is already running. The returned error is never
// nil if id == "".
//
// Safety: cmd must be built with exec.Command (not sh -c with user input).
// DEBIAN_FRONTEND=noninteractive must be set by the caller for apt commands.
func (e *Executor) Start(jobType string, cmd *exec.Cmd, db *store.DB) (string, error) {
	return e.start(jobType, cmd, db, false)
}

// StartPTY is like Start but runs cmd attached to a pseudo-terminal, so
// interactive tools (whiptail menus in the community-scripts) render and can
// read keystrokes fed back via Input. Output is streamed raw (ANSI included)
// as {"type":"out","data":...} frames instead of line-typed stdout/stderr.
func (e *Executor) StartPTY(jobType string, cmd *exec.Cmd, db *store.DB) (string, error) {
	return e.start(jobType, cmd, db, true)
}

func (e *Executor) start(jobType string, cmd *exec.Cmd, db *store.DB, interactive bool) (string, error) {
	e.mu.Lock()
	if e.current != nil {
		e.mu.Unlock()
		return "", ErrBusy
	}
	id := newID()
	job := &activeJob{id: id, jobType: jobType}
	e.current = job // holds the slot before we release the lock
	e.mu.Unlock()

	now := time.Now()
	if err := db.CreateJob(id, jobType, now); err != nil {
		// Roll back the slot — no goroutine started yet.
		e.mu.Lock()
		e.current = nil
		e.mu.Unlock()
		return "", fmt.Errorf("create job record: %w", err)
	}

	go e.run(job, cmd, db, now, interactive)
	return id, nil
}

// Input writes data to a running interactive job's PTY (keystrokes from the web
// terminal). No-op if the job isn't current or isn't a PTY job.
func (e *Executor) Input(id string, data []byte) {
	e.mu.Lock()
	job := e.current
	e.mu.Unlock()
	if job == nil || job.id != id {
		return
	}
	job.mu.Lock()
	ptmx := job.ptmx
	job.mu.Unlock()
	if ptmx != nil {
		ptmx.Write(data) //nolint:errcheck
	}
}

// Subscribe returns the accumulated output so far plus a channel for future
// lines if the job id is currently running. Returns active=false when the job
// has finished (or never existed) — caller should then query SQLite.
//
// The returned channel is closed when the job ends; range over it naturally.
func (e *Executor) Subscribe(id string) (history []string, ch chan string, active bool) {
	e.mu.Lock()
	if e.current == nil || e.current.id != id {
		e.mu.Unlock()
		return nil, nil, false
	}
	job := e.current
	e.mu.Unlock()
	// job pointer is safe to use: the run goroutine only nils e.current in
	// its own defer, and it marks job.done before that, which we check below.

	job.mu.Lock()
	defer job.mu.Unlock()
	if job.done {
		return nil, nil, false // caller falls through to SQLite
	}
	ch = make(chan string, 256)
	history = append([]string{}, job.lines...)
	job.subs = append(job.subs, ch)
	return history, ch, true
}

// Active reports whether a job is currently running (for the 409 check).
func (e *Executor) Active() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.current != nil
}

func (e *Executor) run(job *activeJob, cmd *exec.Cmd, db *store.DB, startedAt time.Time, interactive bool) {
	exitCode := -1
	status := "failed"

	defer func() {
		if r := recover(); r != nil {
			log.Printf("executor panic in job %s: %v", job.id, r)
		}

		// 1. Persist (with "done" line already appended below).
		output := job.outputString()
		if err := db.FinishJob(job.id, status, exitCode, time.Now(), output); err != nil {
			log.Printf("persist job %s: %v", job.id, err)
		}

		// 2. Mark done and collect subscribers atomically, then clear the slot.
		job.mu.Lock()
		job.done = true
		subs := make([]chan string, len(job.subs))
		copy(subs, job.subs)
		job.mu.Unlock()

		e.mu.Lock()
		e.current = nil
		e.mu.Unlock()

		// 3. Close subscriber channels so their range loops terminate.
		for _, ch := range subs {
			close(ch)
		}
	}()

	if interactive {
		exitCode, status = e.runPTY(job, cmd)
		e.emit(job, encDone(exitCode))
		return
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		e.emit(job, encLine("stderr", "failed to open stdout pipe: "+err.Error()))
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		e.emit(job, encLine("stderr", "failed to open stderr pipe: "+err.Error()))
		return
	}
	if err := cmd.Start(); err != nil {
		e.emit(job, encLine("stderr", "failed to start command: "+err.Error()))
		return
	}

	// Read stdout and stderr concurrently, merge into one channel.
	merged := make(chan string, 64)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		sc := bufio.NewScanner(stdout)
		for sc.Scan() {
			merged <- encLine("stdout", sc.Text())
		}
	}()
	go func() {
		defer wg.Done()
		sc := bufio.NewScanner(stderr)
		for sc.Scan() {
			merged <- encLine("stderr", sc.Text())
		}
	}()
	go func() { wg.Wait(); close(merged) }()

	for line := range merged {
		e.emit(job, line)
	}

	// Both pipes fully drained — safe to call Wait.
	if err := cmd.Wait(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			exitCode = ee.ExitCode()
		}
		// status stays "failed"
	} else {
		exitCode = 0
		status = "succeeded"
	}

	// Broadcast the done message before the defer closes subscriber channels.
	e.emit(job, encDone(exitCode))
}

// runPTY starts cmd on a pseudo-terminal, streams its raw output as "out"
// frames, and exposes the master via job.ptmx so Input can feed keystrokes.
// Returns the exit code and final status.
func (e *Executor) runPTY(job *activeJob, cmd *exec.Cmd) (exitCode int, status string) {
	exitCode, status = -1, "failed"

	ptmx, err := pty.Start(cmd)
	if err != nil {
		e.emit(job, encLine("stderr", "failed to start pty: "+err.Error()))
		return
	}
	// ponytail: fixed 90x28 — matches the xterm size on the client so whiptail
	// menus line up. Wire a resize control message if variable sizing matters.
	_ = pty.Setsize(ptmx, &pty.Winsize{Rows: 28, Cols: 90})

	job.mu.Lock()
	job.ptmx = ptmx
	job.mu.Unlock()
	defer ptmx.Close()

	// Read raw bytes until the child exits (Linux returns EIO on the master
	// once the slave closes — treated as normal EOF, not an error to surface).
	buf := make([]byte, 4096)
	for {
		n, rerr := ptmx.Read(buf)
		if n > 0 {
			e.emit(job, encOut(buf[:n]))
		}
		if rerr != nil {
			break
		}
	}

	if werr := cmd.Wait(); werr != nil {
		if ee, ok := werr.(*exec.ExitError); ok {
			exitCode = ee.ExitCode()
		}
		return exitCode, "failed"
	}
	return 0, "succeeded"
}

// emit appends a JSON line to job history and fans it out to subscribers.
func (e *Executor) emit(job *activeJob, line string) {
	job.mu.Lock()
	job.lines = append(job.lines, line)
	for _, ch := range job.subs {
		select {
		case ch <- line:
		default: // slow consumer: drop this frame rather than blocking the run loop
		}
	}
	job.mu.Unlock()
}

func (j *activeJob) outputString() string {
	j.mu.Lock()
	defer j.mu.Unlock()
	return strings.Join(j.lines, "\n")
}

// --- helpers ---

func encLine(typ, line string) string {
	b, _ := json.Marshal(map[string]string{"type": typ, "line": line})
	return string(b)
}

func encOut(b []byte) string {
	out, _ := json.Marshal(map[string]string{"type": "out", "data": string(b)})
	return string(out)
}

func encDone(exitCode int) string {
	b, _ := json.Marshal(map[string]any{"type": "done", "exit_code": exitCode})
	return string(b)
}

func newID() string {
	b := make([]byte, 16)
	rand.Read(b) //nolint:errcheck
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
