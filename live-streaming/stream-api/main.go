package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func main() {
	// ── Database ──────────────────────────────────────────────────────────
	dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=disable",
		env("DB_HOST", "localhost"),
		env("DB_USER", "postgres"),
		env("DB_PASS", "postgres"),
		env("DB_NAME", "livestreaming"),
		env("DB_PORT", "5433"),
	)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	if err := db.AutoMigrate(&User{}, &Channel{}, &StreamSession{}); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	// ── Redis ─────────────────────────────────────────────────────────────
	rdb := redis.NewClient(&redis.Options{
		Addr: env("REDIS_ADDR", "localhost:6380"),
	})

	// ── Wire up services and handlers ─────────────────────────────────────
	jwtSecret := []byte(env("JWT_SECRET", "livestreaming-super-secret-key-must-be-at-least-256-bits-long-for-hs256"))
	hlsBase := env("HLS_BASE_URL", "http://localhost:8084")

	authH := &authHandler{svc: &authService{db: db, jwtSecret: jwtSecret, expirationMs: 86400000}}
	chanH := &channelHandler{svc: &channelService{db: db, rdb: rdb, hlsBase: hlsBase}}
	internalH := &internalHandler{svc: &streamEventService{db: db, rdb: rdb}}

	// ── Routes ────────────────────────────────────────────────────────────
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		jsonOK(w, map[string]string{"status": "ok", "service": "stream-api"}, http.StatusOK)
	})

	// Auth — public
	mux.HandleFunc("POST /api/auth/register", authH.register)
	mux.HandleFunc("POST /api/auth/login", authH.login)

	// Channels — public reads
	mux.HandleFunc("GET /api/channels", chanH.listLive)
	mux.HandleFunc("GET /api/channels/{id}", chanH.getChannel)

	// Channels — protected (note: /me must be registered before /{id} so the literal wins)
	auth := jwtMiddleware(jwtSecret)
	mux.Handle("GET /api/channels/me", auth(http.HandlerFunc(chanH.getMyChannel)))
	mux.Handle("GET /api/channels/me/stream-key", auth(http.HandlerFunc(chanH.getStreamKey)))
	mux.Handle("PATCH /api/channels/me", auth(http.HandlerFunc(chanH.updateChannel)))
	mux.Handle("POST /api/channels/me/stream-key/regenerate", auth(http.HandlerFunc(chanH.regenerateStreamKey)))

	// Internal — SRS hooks (trusted internal network, no auth)
	mux.HandleFunc("POST /internal/stream/start", internalH.onPublish)
	mux.HandleFunc("POST /internal/stream/end", internalH.onUnpublish)

	port := env("PORT", "8082")
	log.Printf("stream-api listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func generateStreamKey() string {
	return uuid.New().String()
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
