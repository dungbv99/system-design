package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
)

var (
	db  *sql.DB
	rdb *redis.Client
	ctx = context.Background()
)

// ── domain types ─────────────────────────────────────────────────────────────

type Job struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Payload    string    `json:"payload"`
	Priority   int       `json:"priority"`
	Status     string    `json:"status"`
	WorkflowID string    `json:"workflow_id,omitempty"`
	WorkerID   string    `json:"worker_id,omitempty"`
	RetryCount int       `json:"retry_count"`
	MaxRetries int       `json:"max_retries"`
	ErrorMsg   string    `json:"error_msg,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type Workflow struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Status    string    `json:"status"`
	Jobs      []Job     `json:"jobs,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ── request types ─────────────────────────────────────────────────────────────

type SubmitJobRequest struct {
	Name       string `json:"name"        binding:"required"`
	Payload    string `json:"payload"`
	Priority   int    `json:"priority"`
	MaxRetries int    `json:"max_retries"`
}

// WorkflowJobSpec is one node in the submitted DAG.
// LogicalID is a client-assigned name used only to wire up DependsOn references.
type WorkflowJobSpec struct {
	LogicalID  string   `json:"id"          binding:"required"`
	Name       string   `json:"name"        binding:"required"`
	Payload    string   `json:"payload"`
	Priority   int      `json:"priority"`
	MaxRetries int      `json:"max_retries"`
	DependsOn  []string `json:"depends_on"`
}

type SubmitWorkflowRequest struct {
	Name string            `json:"name" binding:"required"`
	Jobs []WorkflowJobSpec `json:"jobs" binding:"required"`
}

// ── main ──────────────────────────────────────────────────────────────────────

func main() {
	var err error
	db, err = sql.Open("postgres", dsn())
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	rdb = redis.NewClient(&redis.Options{Addr: env("REDIS_ADDR", "localhost:6379")})
	defer rdb.Close()

	waitForDB()

	r := gin.Default()

	r.GET("/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })

	r.POST("/api/jobs", submitJob)
	r.GET("/api/jobs", listJobs)
	r.GET("/api/jobs/:id", getJob)
	r.DELETE("/api/jobs/:id", cancelJob)

	r.POST("/api/workflows", submitWorkflow)
	r.GET("/api/workflows", listWorkflows)
	r.GET("/api/workflows/:id", getWorkflow)
	r.DELETE("/api/workflows/:id", cancelWorkflow)

	r.GET("/api/workers", listWorkers)

	log.Printf("job-service listening on :%s", env("PORT", "8085"))
	r.Run(":" + env("PORT", "8085"))
}

// ── standalone job handlers ───────────────────────────────────────────────────

func submitJob(c *gin.Context) {
	var req SubmitJobRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Priority < 0 || req.Priority > 3 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "priority must be 0–3"})
		return
	}
	if req.MaxRetries == 0 {
		req.MaxRetries = 3
	}

	now := time.Now()
	job := Job{
		ID:         uuid.New().String(),
		Name:       req.Name,
		Payload:    req.Payload,
		Priority:   req.Priority,
		Status:     "PENDING",
		MaxRetries: req.MaxRetries,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	_, err := db.Exec(
		`INSERT INTO jobs (id,name,payload,priority,status,retry_count,max_retries,created_at,updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		job.ID, job.Name, job.Payload, job.Priority, job.Status,
		job.RetryCount, job.MaxRetries, now, now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	enqueue(job.ID, job.Priority, now)
	c.JSON(http.StatusCreated, job)
}

func getJob(c *gin.Context) {
	job, err := fetchJob(c.Param("id"))
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, job)
}

func listJobs(c *gin.Context) {
	status := c.Query("status")
	var rows *sql.Rows
	var err error
	base := `SELECT id,name,payload,priority,status,COALESCE(workflow_id,''),COALESCE(worker_id,''),
	          retry_count,max_retries,COALESCE(error_msg,''),created_at,updated_at
	          FROM jobs %s ORDER BY priority, created_at DESC LIMIT 200`
	if status != "" {
		rows, err = db.Query(fmt.Sprintf(base, "WHERE status=$1"), status)
	} else {
		rows, err = db.Query(fmt.Sprintf(base, ""))
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	jobs := scanJobs(rows)
	c.JSON(http.StatusOK, jobs)
}

func cancelJob(c *gin.Context) {
	id := c.Param("id")
	res, err := db.Exec(
		`UPDATE jobs SET status='CANCELLED', updated_at=NOW() WHERE id=$1 AND status IN ('PENDING','ASSIGNED')`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found or already running"})
		return
	}
	rdb.ZRem(ctx, "jobs:queue", id)
	c.JSON(http.StatusOK, gin.H{"message": "cancelled"})
}

// ── workflow handlers ─────────────────────────────────────────────────────────

func submitWorkflow(c *gin.Context) {
	var req SubmitWorkflowRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.Jobs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "workflow must have at least one job"})
		return
	}

	// Validate logical IDs are unique and all dependency references exist
	known := map[string]bool{}
	for _, j := range req.Jobs {
		if known[j.LogicalID] {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("duplicate job id: %s", j.LogicalID)})
			return
		}
		known[j.LogicalID] = true
	}
	for _, j := range req.Jobs {
		for _, dep := range j.DependsOn {
			if !known[dep] {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("unknown dependency: %s", dep)})
				return
			}
		}
	}
	if hasCycle(req.Jobs) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "workflow contains a cycle"})
		return
	}

	now := time.Now()
	workflowID := uuid.New().String()

	// Map logical IDs to real UUIDs before opening the transaction
	idMap := make(map[string]string, len(req.Jobs))
	for _, j := range req.Jobs {
		idMap[j.LogicalID] = uuid.New().String()
	}

	tx, err := db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer tx.Rollback()

	if _, err = tx.Exec(
		`INSERT INTO workflows (id,name,status,created_at,updated_at) VALUES ($1,$2,'RUNNING',$3,$4)`,
		workflowID, req.Name, now, now); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var rootJobs []Job
	for _, spec := range req.Jobs {
		if spec.MaxRetries == 0 {
			spec.MaxRetries = 3
		}
		jobID := idMap[spec.LogicalID]
		status := "WAITING"
		if len(spec.DependsOn) == 0 {
			status = "PENDING"
			rootJobs = append(rootJobs, Job{ID: jobID, Priority: spec.Priority, CreatedAt: now})
		}
		if _, err = tx.Exec(
			`INSERT INTO jobs (id,name,payload,priority,status,workflow_id,retry_count,max_retries,created_at,updated_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			jobID, spec.Name, spec.Payload, spec.Priority, status,
			workflowID, 0, spec.MaxRetries, now, now); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	for _, spec := range req.Jobs {
		for _, dep := range spec.DependsOn {
			if _, err = tx.Exec(
				`INSERT INTO job_dependencies (job_id, depends_on) VALUES ($1,$2)`,
				idMap[spec.LogicalID], idMap[dep]); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
	}

	if err = tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	for _, j := range rootJobs {
		enqueue(j.ID, j.Priority, j.CreatedAt)
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":         workflowID,
		"name":       req.Name,
		"status":     "RUNNING",
		"job_count":  len(req.Jobs),
		"created_at": now,
	})
}

func getWorkflow(c *gin.Context) {
	id := c.Param("id")
	var wf Workflow
	err := db.QueryRow(
		`SELECT id,name,status,created_at,updated_at FROM workflows WHERE id=$1`, id).
		Scan(&wf.ID, &wf.Name, &wf.Status, &wf.CreatedAt, &wf.UpdatedAt)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	rows, err := db.Query(
		`SELECT id,name,payload,priority,status,COALESCE(workflow_id,''),COALESCE(worker_id,''),
		        retry_count,max_retries,COALESCE(error_msg,''),created_at,updated_at
		 FROM jobs WHERE workflow_id=$1 ORDER BY created_at`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	wf.Jobs = scanJobs(rows)
	c.JSON(http.StatusOK, wf)
}

func listWorkflows(c *gin.Context) {
	rows, err := db.Query(
		`SELECT id,name,status,created_at,updated_at FROM workflows ORDER BY created_at DESC LIMIT 100`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	var workflows []Workflow
	for rows.Next() {
		var wf Workflow
		rows.Scan(&wf.ID, &wf.Name, &wf.Status, &wf.CreatedAt, &wf.UpdatedAt)
		workflows = append(workflows, wf)
	}
	if workflows == nil {
		workflows = []Workflow{}
	}
	c.JSON(http.StatusOK, workflows)
}

func cancelWorkflow(c *gin.Context) {
	id := c.Param("id")
	res, err := db.Exec(
		`UPDATE workflows SET status='CANCELLED', updated_at=NOW() WHERE id=$1 AND status='RUNNING'`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "workflow not found or not running"})
		return
	}
	// Cancel all non-terminal jobs in the workflow; scheduler cascade handles WAITING deps
	db.Exec(
		`UPDATE jobs SET status='CANCELLED', updated_at=NOW()
		 WHERE workflow_id=$1 AND status IN ('PENDING','WAITING','ASSIGNED')`, id)

	// Purge any pending queue entries
	rows, _ := db.Query(`SELECT id FROM jobs WHERE workflow_id=$1`, id)
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var jid string
			rows.Scan(&jid)
			rdb.ZRem(ctx, "jobs:queue", jid)
		}
	}
	c.JSON(http.StatusOK, gin.H{"message": "cancelled"})
}

// ── workers handler ───────────────────────────────────────────────────────────

func listWorkers(c *gin.Context) {
	ids, err := rdb.SMembers(ctx, "workers:active").Result()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var workers []map[string]string
	for _, id := range ids {
		info, _ := rdb.HGetAll(ctx, "worker:"+id+":info").Result()
		if len(info) > 0 {
			workers = append(workers, info)
		}
	}
	if workers == nil {
		workers = []map[string]string{}
	}
	c.JSON(http.StatusOK, workers)
}

// ── DAG validation ────────────────────────────────────────────────────────────

// hasCycle runs Kahn's algorithm (topological sort) on the submitted job specs.
// Returns true if a cycle is detected.
func hasCycle(jobs []WorkflowJobSpec) bool {
	inDegree := make(map[string]int, len(jobs))
	children := make(map[string][]string)

	for _, j := range jobs {
		if _, ok := inDegree[j.LogicalID]; !ok {
			inDegree[j.LogicalID] = 0
		}
		for _, dep := range j.DependsOn {
			inDegree[j.LogicalID]++
			children[dep] = append(children[dep], j.LogicalID)
		}
	}

	queue := []string{}
	for id, deg := range inDegree {
		if deg == 0 {
			queue = append(queue, id)
		}
	}
	processed := 0
	for len(queue) > 0 {
		node := queue[0]
		queue = queue[1:]
		processed++
		for _, child := range children[node] {
			inDegree[child]--
			if inDegree[child] == 0 {
				queue = append(queue, child)
			}
		}
	}
	return processed != len(jobs)
}

// ── helpers ───────────────────────────────────────────────────────────────────

func fetchJob(id string) (*Job, error) {
	var j Job
	err := db.QueryRow(
		`SELECT id,name,payload,priority,status,COALESCE(workflow_id,''),COALESCE(worker_id,''),
		        retry_count,max_retries,COALESCE(error_msg,''),created_at,updated_at
		 FROM jobs WHERE id=$1`, id).
		Scan(&j.ID, &j.Name, &j.Payload, &j.Priority, &j.Status,
			&j.WorkflowID, &j.WorkerID, &j.RetryCount, &j.MaxRetries, &j.ErrorMsg,
			&j.CreatedAt, &j.UpdatedAt)
	return &j, err
}

func scanJobs(rows *sql.Rows) []Job {
	var jobs []Job
	for rows.Next() {
		var j Job
		rows.Scan(&j.ID, &j.Name, &j.Payload, &j.Priority, &j.Status,
			&j.WorkflowID, &j.WorkerID, &j.RetryCount, &j.MaxRetries, &j.ErrorMsg,
			&j.CreatedAt, &j.UpdatedAt)
		jobs = append(jobs, j)
	}
	if jobs == nil {
		return []Job{}
	}
	return jobs
}

// score = priority×10¹³ + timestamp_ms so P0 always beats P1 > P2 > P3
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
