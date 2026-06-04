package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
)

var (
	db  *sql.DB
	rdb *redis.Client
	ctx = context.Background()
)

const (
	leaseTTL        = 60 * time.Second
	scheduleEvery   = 500 * time.Millisecond
	healthEvery     = 3 * time.Second
	workerDeadAfter = 30 * time.Second

	// Raft timing. Election timeout >> heartbeat so followers don't trigger
	// spurious elections while a healthy leader is running.
	electionMinMS     = 150
	electionMaxMS     = 300
	heartbeatInterval = 50 * time.Millisecond
	rpcTimeout        = 80 * time.Millisecond
)

// ── Raft node ─────────────────────────────────────────────────────────────────

type nodeRole int

const (
	roleFollower  nodeRole = iota
	roleCandidate nodeRole = iota
	roleLeader    nodeRole = iota
)

func (r nodeRole) String() string {
	return [...]string{"follower", "candidate", "leader"}[r]
}

// Raft holds all per-node state. Only the three fields under mu are shared
// across goroutines; everything else is read-only after construction.
type Raft struct {
	id    string   // unique node name, e.g. "scheduler-1"
	peers []string // "host:port" of every *other* Raft node
	addr  string   // ":port" this node listens on for RPCs

	mu       sync.Mutex
	term     int64    // current Raft term (monotonically increasing)
	votedFor string   // candidate we voted for this term; "" = not yet voted
	role     nodeRole

	// Non-blocking channel: AppendEntries handler signals the follower/candidate
	// loop that a valid heartbeat was received.
	heartbeatCh chan struct{}
}

// ── RPC message types ─────────────────────────────────────────────────────────

type voteReq struct {
	Term        int64  `json:"term"`
	CandidateID string `json:"candidate_id"`
}

type voteResp struct {
	Term        int64 `json:"term"`
	VoteGranted bool  `json:"vote_granted"`
}

type appendReq struct {
	Term     int64  `json:"term"`
	LeaderID string `json:"leader_id"`
}

type appendResp struct {
	Term    int64 `json:"term"`
	Success bool  `json:"success"`
}

// ── Constructor ───────────────────────────────────────────────────────────────

func newRaft(id, addr string, peers []string) *Raft {
	return &Raft{
		id:          id,
		addr:        addr,
		peers:       peers,
		role:        roleFollower,
		heartbeatCh: make(chan struct{}, 8),
	}
}

// ── Public API ────────────────────────────────────────────────────────────────

func (r *Raft) IsLeader() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.role == roleLeader
}

// ── State machine ─────────────────────────────────────────────────────────────

// run drives the Raft state machine. Each role function runs until it decides
// to transition, then returns so run() picks up the new role.
func (r *Raft) run() {
	for {
		r.mu.Lock()
		cur := r.role
		r.mu.Unlock()
		switch cur {
		case roleFollower:
			r.runFollower()
		case roleCandidate:
			r.runCandidate()
		case roleLeader:
			r.runLeader()
		}
	}
}

// runFollower waits for a heartbeat. If the election timer fires first, it
// transitions to candidate.
func (r *Raft) runFollower() {
	r.mu.Lock()
	log.Printf("[%s] → follower  (term %d)", r.id, r.term)
	r.mu.Unlock()

	timer := time.NewTimer(randomElectionTimeout())
	defer timer.Stop()

	for {
		select {
		case <-r.heartbeatCh:
			// Valid leader is alive — reset the timer.
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(randomElectionTimeout())

		case <-timer.C:
			// No heartbeat within the timeout — start an election.
			r.mu.Lock()
			r.role = roleCandidate
			r.mu.Unlock()
			return
		}
	}
}

// runCandidate increments the term, votes for itself, and sends RequestVote
// RPCs to all peers in parallel. It becomes leader on majority, falls back to
// follower on a higher-term reply or a heartbeat from a valid leader, and
// retries (with a new term) on a split vote / timeout.
func (r *Raft) runCandidate() {
	r.mu.Lock()
	r.term++
	r.votedFor = r.id
	term := r.term
	r.mu.Unlock()

	log.Printf("[%s] → candidate (term %d)", r.id, term)

	// majority of the full cluster (peers + self)
	majority := (len(r.peers)+1)/2 + 1
	votes := 1 // self-vote

	voteCh := make(chan *voteResp, len(r.peers))
	for _, p := range r.peers {
		go func(peer string) {
			voteCh <- r.callRequestVote(peer, voteReq{Term: term, CandidateID: r.id})
		}(p)
	}

	timer := time.NewTimer(randomElectionTimeout())
	defer timer.Stop()
	seen := 0

	for seen < len(r.peers) {
		select {
		case resp := <-voteCh:
			seen++
			if resp == nil {
				continue // network error — treat as denied
			}
			r.mu.Lock()
			if resp.Term > r.term {
				// We're behind; immediately step down.
				r.term = resp.Term
				r.votedFor = ""
				r.role = roleFollower
				r.mu.Unlock()
				return
			}
			r.mu.Unlock()

			if resp.VoteGranted {
				votes++
				if votes >= majority {
					r.mu.Lock()
					if r.term == term { // guard: no term change while collecting votes
						r.role = roleLeader
					}
					r.mu.Unlock()
					return
				}
			}

		case <-r.heartbeatCh:
			// A valid leader exists for this term — concede.
			r.mu.Lock()
			if r.role == roleCandidate {
				r.role = roleFollower
			}
			r.mu.Unlock()
			return

		case <-timer.C:
			// Split vote — return without changing role so run() re-enters
			// runCandidate() with a fresh incremented term.
			return
		}
	}

	// Heard from all peers; still no majority.
	r.mu.Lock()
	if r.role == roleCandidate {
		r.role = roleFollower
	}
	r.mu.Unlock()
}

// runLeader sends periodic heartbeats to prevent followers from timing out.
// It steps down immediately if it discovers a higher term.
func (r *Raft) runLeader() {
	r.mu.Lock()
	term := r.term
	r.mu.Unlock()

	log.Printf("[%s] → leader    (term %d)", r.id, term)

	// Assert leadership immediately rather than waiting for the first tick.
	r.broadcastHeartbeat(term)

	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			r.mu.Lock()
			if r.role != roleLeader {
				r.mu.Unlock()
				return
			}
			currentTerm := r.term
			r.mu.Unlock()
			r.broadcastHeartbeat(currentTerm)

		case <-r.heartbeatCh:
			// handleAppendEntries may have already stepped us down if it saw
			// a higher term; check and exit if so.
			r.mu.Lock()
			if r.role != roleLeader {
				r.mu.Unlock()
				return
			}
			r.mu.Unlock()
		}
	}
}

// broadcastHeartbeat sends AppendEntries to every peer in parallel and steps
// down if any peer reports a higher term.
func (r *Raft) broadcastHeartbeat(term int64) {
	for _, p := range r.peers {
		go func(peer string) {
			resp := r.callAppendEntries(peer, appendReq{Term: term, LeaderID: r.id})
			if resp == nil {
				return
			}
			if resp.Term > term {
				r.mu.Lock()
				if resp.Term > r.term {
					r.term = resp.Term
					r.votedFor = ""
					r.role = roleFollower
				}
				r.mu.Unlock()
			}
		}(p)
	}
}

// ── RPC clients ───────────────────────────────────────────────────────────────

func (r *Raft) callRequestVote(peer string, req voteReq) *voteResp {
	body, _ := json.Marshal(req)
	client := &http.Client{Timeout: rpcTimeout}
	res, err := client.Post("http://"+peer+"/raft/request-vote", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil
	}
	defer res.Body.Close()
	var resp voteResp
	if json.NewDecoder(res.Body).Decode(&resp) != nil {
		return nil
	}
	return &resp
}

func (r *Raft) callAppendEntries(peer string, req appendReq) *appendResp {
	body, _ := json.Marshal(req)
	client := &http.Client{Timeout: rpcTimeout}
	res, err := client.Post("http://"+peer+"/raft/append-entries", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil
	}
	defer res.Body.Close()
	var resp appendResp
	if json.NewDecoder(res.Body).Decode(&resp) != nil {
		return nil
	}
	return &resp
}

// ── RPC handlers ──────────────────────────────────────────────────────────────

// handleRequestVote grants a vote to the candidate if:
//   - The candidate's term is at least as large as ours, AND
//   - We haven't already voted for someone else this term.
func (r *Raft) handleRequestVote(w http.ResponseWriter, req *http.Request) {
	var vr voteReq
	if err := json.NewDecoder(req.Body).Decode(&vr); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	resp := voteResp{Term: r.term}

	if vr.Term < r.term {
		// Stale candidate — reject.
		json.NewEncoder(w).Encode(resp)
		return
	}
	if vr.Term > r.term {
		// Newer term discovered — update and reset vote.
		r.term = vr.Term
		r.votedFor = ""
		r.role = roleFollower
	}

	if r.votedFor == "" || r.votedFor == vr.CandidateID {
		r.votedFor = vr.CandidateID
		resp.Term = r.term
		resp.VoteGranted = true
		log.Printf("[%s] voted for %s (term %d)", r.id, vr.CandidateID, r.term)
	}
	json.NewEncoder(w).Encode(resp)
}

// handleAppendEntries (heartbeat-only) resets the follower election timer and
// steps down any candidate/stale leader that hears from a valid leader.
func (r *Raft) handleAppendEntries(w http.ResponseWriter, req *http.Request) {
	var ar appendReq
	if err := json.NewDecoder(req.Body).Decode(&ar); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	r.mu.Lock()
	resp := appendResp{Term: r.term}

	if ar.Term < r.term {
		// Stale leader — reject without updating state.
		r.mu.Unlock()
		json.NewEncoder(w).Encode(resp)
		return
	}
	if ar.Term > r.term {
		r.term = ar.Term
		r.votedFor = ""
		r.role = roleFollower
	} else if r.role == roleCandidate {
		// Valid leader for the same term — concede.
		r.role = roleFollower
	}

	resp.Success = true
	resp.Term = r.term
	r.mu.Unlock()

	// Non-blocking send: the follower loop drains this channel.
	select {
	case r.heartbeatCh <- struct{}{}:
	default:
	}

	json.NewEncoder(w).Encode(resp)
}

func (r *Raft) startServer() {
	mux := http.NewServeMux()
	mux.HandleFunc("/raft/request-vote", r.handleRequestVote)
	mux.HandleFunc("/raft/append-entries", r.handleAppendEntries)
	log.Printf("[%s] raft HTTP listening on %s", r.id, r.addr)
	log.Fatal(http.ListenAndServe(r.addr, mux))
}

func randomElectionTimeout() time.Duration {
	return time.Duration(electionMinMS+rand.Intn(electionMaxMS-electionMinMS)) * time.Millisecond
}

// ── main ──────────────────────────────────────────────────────────────────────

var node *Raft

func main() {
	id := env("SCHEDULER_ID", "scheduler-1")

	raftAddr := env("RAFT_ADDR", ":8086")
	var peers []string
	for _, p := range strings.Split(env("PEERS", ""), ",") {
		if p = strings.TrimSpace(p); p != "" {
			peers = append(peers, p)
		}
	}

	var err error
	db, err = sql.Open("postgres", dsn())
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	rdb = redis.NewClient(&redis.Options{Addr: env("REDIS_ADDR", "localhost:6379")})
	defer rdb.Close()

	waitForDB()

	node = newRaft(id, raftAddr, peers)
	go node.startServer()
	go node.run()

	log.Printf("[%s] scheduler started; peers=%v", id, peers)

	go healthLoop()

	for range time.Tick(scheduleEvery) {
		if node.IsLeader() {
			scheduleNext()
		}
	}
}

// ── scheduling loop ───────────────────────────────────────────────────────────

func scheduleNext() {
	results, err := rdb.ZPopMin(ctx, "jobs:queue", 1).Result()
	if err != nil || len(results) == 0 {
		return
	}
	jobID := results[0].Member.(string)

	var status string
	if err := db.QueryRow(`SELECT status FROM jobs WHERE id=$1`, jobID).Scan(&status); err != nil || status != "PENDING" {
		return
	}

	workerID, err := findWorker()
	if err != nil || workerID == "" {
		rdb.ZAdd(ctx, "jobs:queue", results[0])
		return
	}

	res, err := db.Exec(
		`UPDATE jobs SET status='ASSIGNED', worker_id=$1, updated_at=NOW() WHERE id=$2 AND status='PENDING'`,
		workerID, jobID)
	if err != nil {
		rdb.ZAdd(ctx, "jobs:queue", results[0])
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return
	}

	rdb.HIncrBy(ctx, "worker:"+workerID+":info", "available_slots", -1)
	rdb.Set(ctx, "job:lease:"+jobID, workerID, leaseTTL)
	rdb.RPush(ctx, "worker:"+workerID+":jobs", jobID)

	log.Printf("assigned job %s → worker %s", jobID, workerID)
}

func findWorker() (string, error) {
	ids, err := rdb.SMembers(ctx, "workers:active").Result()
	if err != nil {
		return "", err
	}
	for _, id := range ids {
		info, err := rdb.HGetAll(ctx, "worker:"+id+":info").Result()
		if err != nil || info["status"] != "alive" {
			continue
		}
		var slots int
		fmt.Sscanf(info["available_slots"], "%d", &slots)
		if slots > 0 {
			return id, nil
		}
	}
	return "", nil
}

// ── health loop ───────────────────────────────────────────────────────────────

func healthLoop() {
	for range time.Tick(healthEvery) {
		if !node.IsLeader() {
			continue
		}
		reapDeadWorkers()
		recoverExpiredLeases()
		resolveDependencies()
		cascadeFailures()
		updateWorkflowStatuses()
	}
}

// ── worker fault tolerance ────────────────────────────────────────────────────

func reapDeadWorkers() {
	ids, _ := rdb.SMembers(ctx, "workers:active").Result()
	for _, id := range ids {
		info, err := rdb.HGetAll(ctx, "worker:"+id+":info").Result()
		if err != nil || info["last_heartbeat"] == "" {
			continue
		}
		beat, err := time.Parse(time.RFC3339, info["last_heartbeat"])
		if err != nil || time.Since(beat) <= workerDeadAfter {
			continue
		}
		log.Printf("worker %s dead (last beat %s ago)", id, time.Since(beat).Round(time.Second))
		rdb.HSet(ctx, "worker:"+id+":info", "status", "dead")
		rdb.SRem(ctx, "workers:active", id)
		requeueWorkerJobs(id)
	}
}

func requeueWorkerJobs(workerID string) {
	rows, err := db.Query(
		`SELECT id, priority, created_at FROM jobs WHERE worker_id=$1 AND status IN ('ASSIGNED','RUNNING')`,
		workerID)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var priority int
		var createdAt time.Time
		rows.Scan(&id, &priority, &createdAt)
		db.Exec(`UPDATE jobs SET status='PENDING', worker_id=NULL, updated_at=NOW() WHERE id=$1`, id)
		enqueue(id, priority, createdAt)
		rdb.Del(ctx, "job:lease:"+id)
		log.Printf("re-queued job %s from dead worker %s", id, workerID)
	}
}

func recoverExpiredLeases() {
	rows, err := db.Query(
		`SELECT id, priority, created_at, retry_count, max_retries
		 FROM jobs WHERE status IN ('ASSIGNED','RUNNING')`)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var priority, retryCount, maxRetries int
		var createdAt time.Time
		rows.Scan(&id, &priority, &createdAt, &retryCount, &maxRetries)

		if exists, _ := rdb.Exists(ctx, "job:lease:"+id).Result(); exists > 0 {
			continue
		}
		log.Printf("lease expired for job %s (retry %d/%d)", id, retryCount, maxRetries)
		if retryCount >= maxRetries {
			db.Exec(`UPDATE jobs SET status='DEAD', error_msg='max retries exceeded', updated_at=NOW() WHERE id=$1`, id)
		} else {
			db.Exec(`UPDATE jobs SET status='PENDING', worker_id=NULL, updated_at=NOW() WHERE id=$1`, id)
			enqueue(id, priority, createdAt)
		}
	}
}

// ── DAG engine ────────────────────────────────────────────────────────────────

func resolveDependencies() {
	rows, err := db.Query(`
		SELECT j.id, j.priority, j.created_at
		FROM jobs j
		WHERE j.status = 'WAITING'
		AND NOT EXISTS (
			SELECT 1
			FROM job_dependencies d
			JOIN jobs parent ON d.depends_on = parent.id
			WHERE d.job_id = j.id
			  AND parent.status != 'COMPLETED'
		)`)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var priority int
		var createdAt time.Time
		rows.Scan(&id, &priority, &createdAt)
		res, err := db.Exec(
			`UPDATE jobs SET status='PENDING', updated_at=NOW() WHERE id=$1 AND status='WAITING'`, id)
		if err != nil {
			continue
		}
		if n, _ := res.RowsAffected(); n > 0 {
			enqueue(id, priority, createdAt)
			log.Printf("DAG: unlocked job %s (all parents completed)", id)
		}
	}
}

func cascadeFailures() {
	result, err := db.Exec(`
		WITH RECURSIVE downstream AS (
			SELECT d.job_id
			FROM job_dependencies d
			JOIN jobs failed ON d.depends_on = failed.id
			WHERE failed.status IN ('DEAD','CANCELLED')

			UNION

			SELECT d.job_id
			FROM job_dependencies d
			JOIN downstream prev ON d.depends_on = prev.job_id
		)
		UPDATE jobs SET status='CANCELLED', updated_at=NOW()
		WHERE id IN (SELECT job_id FROM downstream)
		  AND status IN ('WAITING','PENDING')`)
	if err != nil {
		log.Printf("cascadeFailures: %v", err)
		return
	}
	if n, _ := result.RowsAffected(); n > 0 {
		log.Printf("DAG: cancelled %d downstream jobs", n)
	}
}

func updateWorkflowStatuses() {
	db.Exec(`
		UPDATE workflows SET status='COMPLETED', updated_at=NOW()
		WHERE status='RUNNING'
		AND NOT EXISTS (
			SELECT 1 FROM jobs WHERE workflow_id = workflows.id
			  AND status NOT IN ('COMPLETED','CANCELLED','DEAD')
		)
		AND NOT EXISTS (
			SELECT 1 FROM jobs WHERE workflow_id = workflows.id AND status='DEAD'
		)`)

	db.Exec(`
		UPDATE workflows SET status='FAILED', updated_at=NOW()
		WHERE status='RUNNING'
		AND EXISTS (SELECT 1 FROM jobs WHERE workflow_id = workflows.id AND status='DEAD')
		AND NOT EXISTS (
			SELECT 1 FROM jobs WHERE workflow_id = workflows.id
			AND status IN ('WAITING','PENDING','ASSIGNED','RUNNING')
		)`)
}

// ── helpers ───────────────────────────────────────────────────────────────────

func enqueue(jobID string, priority int, t time.Time) {
	score := float64(priority)*1e13 + float64(t.UnixMilli())
	rdb.ZAdd(ctx, "jobs:queue", redis.Z{Score: score, Member: jobID})
}

func waitForDB() {
	for i := 0; i < 30; i++ {
		if err := db.Ping(); err == nil {
			return
		}
		log.Println("waiting for postgres...")
		time.Sleep(2 * time.Second)
	}
	log.Fatal("postgres not ready")
}

func dsn() string {
	return fmt.Sprintf("host=%s port=5432 user=%s password=%s dbname=%s sslmode=disable",
		env("DB_HOST", "localhost"), env("DB_USER", "postgres"),
		env("DB_PASSWORD", "postgres"), env("DB_NAME", "jobscheduler"))
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
