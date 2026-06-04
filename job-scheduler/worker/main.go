package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"math/rand"
	"os"
	"os/signal"
	"strconv"
	"syscall"
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
	heartbeatInterval = 10 * time.Second
	leaseTTL          = 60 * time.Second
	failureRate       = 0.15 // 15% of jobs fail
)

func main() {
	workerID := env("WORKER_ID", "")
	if workerID == "" {
		h, _ := os.Hostname()
		workerID = h
	}
	totalSlots, _ := strconv.Atoi(env("SLOTS", "4"))

	var err error
	db, err = sql.Open("postgres", dsn())
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	rdb = redis.NewClient(&redis.Options{Addr: env("REDIS_ADDR", "localhost:6379")})
	defer rdb.Close()

	waitForDB()

	workerKey := "worker:" + workerID + ":info"
	register(workerID, workerKey, totalSlots)
	defer deregister(workerID, workerKey)

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-quit
		log.Printf("[%s] shutting down", workerID)
		deregister(workerID, workerKey)
		os.Exit(0)
	}()

	go heartbeatLoop(workerID, workerKey)

	jobQueue := "worker:" + workerID + ":jobs"
	log.Printf("[%s] ready with %d slots", workerID, totalSlots)

	for {
		result, err := rdb.BLPop(ctx, 5*time.Second, jobQueue).Result()
		if err != nil {
			continue
		}
		go executeJob(workerID, workerKey, result[1])
	}
}

func register(workerID, workerKey string, slots int) {
	rdb.HSet(ctx, workerKey, map[string]interface{}{
		"id":              workerID,
		"total_slots":     slots,
		"available_slots": slots,
		"status":          "alive",
		"last_heartbeat":  time.Now().Format(time.RFC3339),
	})
	rdb.SAdd(ctx, "workers:active", workerID)
}

func deregister(workerID, workerKey string) {
	rdb.HSet(ctx, workerKey, "status", "offline")
	rdb.SRem(ctx, "workers:active", workerID)
}

func heartbeatLoop(workerID, workerKey string) {
	for range time.Tick(heartbeatInterval) {
		rdb.HSet(ctx, workerKey, "last_heartbeat", time.Now().Format(time.RFC3339))
	}
}

func executeJob(workerID, workerKey, jobID string) {
	log.Printf("[%s] starting job %s", workerID, jobID)

	var payload string
	var priority, retryCount, maxRetries int
	var createdAt time.Time
	err := db.QueryRow(
		`SELECT payload, priority, retry_count, max_retries, created_at FROM jobs WHERE id=$1`, jobID).
		Scan(&payload, &priority, &retryCount, &maxRetries, &createdAt)
	if err != nil {
		log.Printf("[%s] cannot fetch job %s: %v — skipping", workerID, jobID, err)
		rdb.HIncrBy(ctx, workerKey, "available_slots", 1)
		return
	}

	db.Exec(`UPDATE jobs SET status='RUNNING', updated_at=NOW() WHERE id=$1`, jobID)

	// Renew lease while running so the scheduler doesn't re-queue a healthy job
	stop := make(chan struct{})
	go renewLease(jobID, stop)

	duration := time.Duration(2+rand.Intn(9)) * time.Second
	time.Sleep(duration)
	failed := rand.Float32() < failureRate

	close(stop)
	rdb.Del(ctx, "job:lease:"+jobID)

	if failed {
		errMsg := fmt.Sprintf("simulated failure after %s", duration)
		if retryCount+1 >= maxRetries {
			db.Exec(`UPDATE jobs SET status='DEAD', error_msg=$1, updated_at=NOW() WHERE id=$2`, errMsg, jobID)
			log.Printf("[%s] job %s -> DEAD (exhausted %d retries)", workerID, jobID, maxRetries)
		} else {
			db.Exec(
				`UPDATE jobs SET status='PENDING', worker_id=NULL, retry_count=retry_count+1, error_msg=$1, updated_at=NOW() WHERE id=$2`,
				errMsg, jobID)
			score := float64(priority)*1e13 + float64(createdAt.UnixMilli())
			rdb.ZAdd(ctx, "jobs:queue", redis.Z{Score: score, Member: jobID})
			log.Printf("[%s] job %s -> retry %d/%d", workerID, jobID, retryCount+1, maxRetries)
		}
	} else {
		db.Exec(`UPDATE jobs SET status='COMPLETED', updated_at=NOW() WHERE id=$1`, jobID)
		log.Printf("[%s] job %s COMPLETED in %s", workerID, jobID, duration)
	}

	rdb.HIncrBy(ctx, workerKey, "available_slots", 1)
}

func renewLease(jobID string, stop <-chan struct{}) {
	ticker := time.NewTicker(leaseTTL / 2)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			rdb.Expire(ctx, "job:lease:"+jobID, leaseTTL)
		}
	}
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
