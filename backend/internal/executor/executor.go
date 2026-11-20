// Package executor runs privileged subprocesses, streams output line-by-line
// to WebSocket subscribers, and persists completed jobs to disk.
//
// Exactly one job may run at a time. The lock is enforced here, not at the
// UI — a UI disable is a nicety on top, not the real guard.
package executor

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"

	"simpdash/internal/store"
)

// ErrBusy is returned by Start when a job is already running.
var ErrBusy = errors.New("a job is already running")

// ActiveJobInfo describes the currently running job for status badges/reconnect.
type ActiveJobInfo struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"`
	StartedAt time.Time `json:"started_at"`
}

// Executor manages a single running job slot.
type Executor struct {
	mu      sync.Mutex
	current *activeJob

	// OnFinish, when set, is called after every job completes and persists.
	// Used for failure notifications. Runs on the job goroutine — keep it fast
	// or dispatch async. Set once at wiring time, before any job starts.
	OnFinish func(jobType, status string, exitCode int)
}

type activeJob struct {
	id        string
	jobType   string
	startedAt time.Time

	ctx    context.Context
	cancel context.CancelFunc

	// mu protects lines, subs, ptmx, activeCmd, done, and cancelled.
	// Never held while e.mu is held.
	mu        sync.Mutex
	done      bool // set before channels are closed; Subscribe checks this
	cancelled bool
	lines     []string // accumulated JSON output lines (including the final "done" line)
	subs      []chan string
	ptmx      *os.File  // PTY master for interactive jobs; nil for pipe-based jobs. Input() writes here.
	activeCmd *exec.Cmd // currently executing subprocess (for cancellation)
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

// Emitter lets custom multi-step jobs (such as batch LXC updates) stream both
// terminal lines and structured JSON progress frames through the standard job
// WebSocket and persistence pipeline.
type Emitter struct {
	e   *Executor
	job *activeJob
}

// Context returns a context that is cancelled when the user cancels this job.
func (em *Emitter) Context() context.Context {
	return em.job.ctx
}

// Cancelled reports whether this job has been cancelled.
func (em *Emitter) Cancelled() bool {
	return em.job.isCancelled()
}

// Line emits a single stdout or stderr line frame.
func (em *Emitter) Line(stream, line string) {
	em.e.emit(em.job, encLine(stream, line))
}

// RawJSON emits a pre-encoded JSON frame (e.g. structured progress events).
func (em *Emitter) RawJSON(frame string) {
	em.e.emit(em.job, frame)
}

// RunCmd runs cmd, streaming its stdout and stderr line-by-line into the job
// stream, and returns its exit code (0 on success, -1 if it failed to start).
func (em *Emitter) RunCmd(cmd *exec.Cmd) int {
	return em.e.runPipes(em.job, cmd)
}

// StartFunc runs a custom Go function inside the Executor's single-job slot,
// returning the job ID immediately. fn returns the final exit code (0 =
// succeeded, non-zero = failed). Returns ErrBusy if a job is already running.
func (e *Executor) StartFunc(jobType string, fn func(em *Emitter) int, db *store.DB) (string, error) {
	now := time.Now().UTC()
	ctx, cancel := context.WithCancel(context.Background())

	e.mu.Lock()
	if e.current != nil {
		e.mu.Unlock()
		cancel()
		return "", ErrBusy
	}
	id := newID()
	job := &activeJob{id: id, jobType: jobType, startedAt: now, ctx: ctx, cancel: cancel}
	e.current = job
	e.mu.Unlock()

	if err := db.CreateJob(id, jobType, now); err != nil {
		e.mu.Lock()
		e.current = nil
		e.mu.Unlock()
		cancel()
		return "", fmt.Errorf("create job record: %w", err)
	}

	go e.runFunc(job, fn, db)
	return id, nil
}

func (e *Executor) start(jobType string, cmd *exec.Cmd, db *store.DB, interactive bool) (string, error) {
	now := time.Now().UTC()
	ctx, cancel := context.WithCancel(context.Background())

	e.mu.Lock()
	if e.current != nil {
		e.mu.Unlock()
		cancel()
		return "", ErrBusy
	}
	id := newID()
	job := &activeJob{id: id, jobType: jobType, startedAt: now, ctx: ctx, cancel: cancel}
	e.current = job // holds the slot before we release the lock
	e.mu.Unlock()

	if err := db.CreateJob(id, jobType, now); err != nil {
		// Roll back the slot — no goroutine started yet.
		e.mu.Lock()
		e.current = nil
		e.mu.Unlock()
		cancel()
		return "", fmt.Errorf("create job record: %w", err)
	}

	go e.run(job, cmd, db, now, interactive)
	return id, nil
}

// Cancel terminates the running job matching id (or the current job if id is
// empty). Signals the subprocess group with SIGTERM, escalating to SIGKILL
// after a short grace period. Returns true if a running job was cancelled.
func (e *Executor) Cancel(id string) bool {
	e.mu.Lock()
	job := e.current
	e.mu.Unlock()
	if job == nil || (id != "" && job.id != id) {
		return false
	}

	job.mu.Lock()
	if job.done {
		job.mu.Unlock()
		return false
	}
	already := job.cancelled
	job.cancelled = true
	cmd := job.activeCmd
	ptmx := job.ptmx
	job.mu.Unlock()

	if !already {
		e.emit(job, encLine("stderr", "[cancelled by user]"))
	}
	job.cancel()

	if cmd != nil && cmd.Process != nil {
		pid := cmd.Process.Pid
		killProcessGroup(pid, syscall.SIGTERM)
		go func(p int, f *os.File) {
			time.Sleep(1500 * time.Millisecond)
			killProcessGroup(p, syscall.SIGKILL)
			if f != nil {
				_ = f.Close()
			}
		}(pid, ptmx)
	} else if ptmx != nil {
		_ = ptmx.Close()
	}
	return true
}

func killProcessGroup(pid int, sig syscall.Signal) {
	if pid <= 0 {
		return
	}
	// Negative PID targets the entire process group (Setpgid or pty Setsid).
	if err := syscall.Kill(-pid, sig); err != nil {
		_ = syscall.Kill(pid, sig)
	}
}

func (j *activeJob) isCancelled() bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.cancelled
}

func (j *activeJob) setCmd(cmd *exec.Cmd) {
	j.mu.Lock()
	j.activeCmd = cmd
	j.mu.Unlock()
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
// has finished (or never existed) — caller should then query the job store.
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
		return nil, nil, false // caller falls through to persisted history
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

// ActiveInfo returns metadata for the currently running job, or nil when idle.
func (e *Executor) ActiveInfo() *ActiveJobInfo {
	e.mu.Lock()
	job := e.current
	e.mu.Unlock()
	if job == nil {
		return nil
	}
	return &ActiveJobInfo{
		ID:        job.id,
		Type:      job.jobType,
		StartedAt: job.startedAt,
	}
}

func (e *Executor) run(job *activeJob, cmd *exec.Cmd, db *store.DB, startedAt time.Time, interactive bool) {
	exitCode := -1
	status := "failed"

	defer func() {
		job.cancel()
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
		job.activeCmd = nil
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

		if e.OnFinish != nil {
			e.OnFinish(job.jobType, status, exitCode)
		}
	}()

	if interactive {
		exitCode, status = e.runPTY(job, cmd)
		if job.isCancelled() {
			status = "cancelled"
			if exitCode == 0 {
				exitCode = -1
			}
		}
		e.emit(job, encDone(exitCode, job.isCancelled()))
		return
	}

	exitCode = e.runPipes(job, cmd)
	if job.isCancelled() {
		status = "cancelled"
		if exitCode == 0 {
			exitCode = -1
		}
	} else if exitCode == 0 {
		status = "succeeded"
	}

	// Broadcast the done message before the defer closes subscriber channels.
	e.emit(job, encDone(exitCode, job.isCancelled()))
}

func (e *Executor) runFunc(job *activeJob, fn func(em *Emitter) int, db *store.DB) {
	exitCode := -1
	status := "failed"

	defer func() {
		job.cancel()
		if r := recover(); r != nil {
			log.Printf("executor panic in job %s: %v", job.id, r)
			e.emit(job, encLine("stderr", fmt.Sprintf("internal error: %v", r)))
			e.emit(job, encDone(-1, false))
		}

		output := job.outputString()
		if err := db.FinishJob(job.id, status, exitCode, time.Now(), output); err != nil {
			log.Printf("persist job %s: %v", job.id, err)
		}

		job.mu.Lock()
		job.done = true
		job.activeCmd = nil
		subs := make([]chan string, len(job.subs))
		copy(subs, job.subs)
		job.mu.Unlock()

		e.mu.Lock()
		e.current = nil
		e.mu.Unlock()

		for _, ch := range subs {
			close(ch)
		}

		if e.OnFinish != nil {
			e.OnFinish(job.jobType, status, exitCode)
		}
	}()

	exitCode = fn(&Emitter{e: e, job: job})
	if job.isCancelled() {
		status = "cancelled"
		if exitCode == 0 {
			exitCode = -1
		}
	} else if exitCode == 0 {
		status = "succeeded"
	}
	e.emit(job, encDone(exitCode, job.isCancelled()))
}

func (e *Executor) runPipes(job *activeJob, cmd *exec.Cmd) int {
	if job.isCancelled() {
		return -1
	}
	// Put child in its own process group so Cancel kills child trees cleanly.
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	} else {
		cp := *cmd.SysProcAttr
		cp.Setpgid = true
		cmd.SysProcAttr = &cp
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		e.emit(job, encLine("stderr", "failed to open stdout pipe: "+err.Error()))
		return -1
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		e.emit(job, encLine("stderr", "failed to open stderr pipe: "+err.Error()))
		return -1
	}
	if err := cmd.Start(); err != nil {
		e.emit(job, encLine("stderr", "failed to start command: "+err.Error()))
		return -1
	}
	job.setCmd(cmd)
	defer job.setCmd(nil)

	// Handle race where Cancel arrived right before cmd.Start completed.
	if job.isCancelled() && cmd.Process != nil {
		killProcessGroup(cmd.Process.Pid, syscall.SIGTERM)
	}

	// Read stdout and stderr concurrently, merge into one channel.
	// Raise scanner ceiling to 1 MB so long unbroken lines don't abort scanning.
	const maxScanLine = 1024 * 1024
	merged := make(chan string, 64)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 0, 64*1024), maxScanLine)
		for sc.Scan() {
			merged <- encLine("stdout", sc.Text())
		}
	}()
	go func() {
		defer wg.Done()
		sc := bufio.NewScanner(stderr)
		sc.Buffer(make([]byte, 0, 64*1024), maxScanLine)
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
			return ee.ExitCode()
		}
		return -1
	}
	return 0
}

// runPTY starts cmd on a pseudo-terminal, streams its raw output as "out"
// frames, and exposes the master via job.ptmx so Input can feed keystrokes.
// Returns the exit code and final status.
func (e *Executor) runPTY(job *activeJob, cmd *exec.Cmd) (exitCode int, status string) {
	exitCode, status = -1, "failed"
	if job.isCancelled() {
		return
	}

	ptmx, err := pty.Start(cmd)
	if err != nil {
		e.emit(job, encLine("stderr", "failed to start pty: "+err.Error()))
		return
	}
	// Fixed 90x28 — matches the xterm size on the client so whiptail menus line up.
	_ = pty.Setsize(ptmx, &pty.Winsize{Rows: 28, Cols: 90})

	job.mu.Lock()
	job.ptmx = ptmx
	job.activeCmd = cmd
	wasCancelled := job.cancelled
	job.mu.Unlock()
	defer func() {
		job.mu.Lock()
		job.ptmx = nil
		job.activeCmd = nil
		job.mu.Unlock()
		_ = ptmx.Close()
	}()

	if wasCancelled && cmd.Process != nil {
		killProcessGroup(cmd.Process.Pid, syscall.SIGTERM)
	}

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

func encDone(exitCode int, cancelled bool) string {
	m := map[string]any{"type": "done", "exit_code": exitCode}
	if cancelled {
		m["cancelled"] = true
	}
	b, _ := json.Marshal(m)
	return string(b)
}

func newID() string {
	b := make([]byte, 16)
	rand.Read(b) //nolint:errcheck
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
