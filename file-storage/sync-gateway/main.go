package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type server struct {
	rdb       *redis.Client
	jwtSecret []byte
}

func main() {
	redisAddr := env("REDIS_ADDR", "localhost:6379")
	port := env("PORT", "8081")
	jwtSecret := env("JWT_SECRET", "change-me")

	rdb := redis.NewClient(&redis.Options{Addr: redisAddr})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("redis connect failed: %v", err)
	}
	log.Printf("connected to redis at %s", redisAddr)

	s := &server{rdb: rdb, jwtSecret: []byte(jwtSecret)}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.health)
	mux.HandleFunc("/ws", s.handleWS)

	log.Printf("sync-gateway listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok","service":"sync-gateway"}`))
}

// handleWS upgrades the connection and forwards Redis pub/sub messages to the client.
// The Java file-storage service publishes to "sync:{userID}" whenever a change occurs.
// Connect: ws://localhost:8081/ws?token=<jwt>
func (s *server) handleWS(w http.ResponseWriter, r *http.Request) {
	userID, err := s.userIDFromToken(r.URL.Query().Get("token"))
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	channel := "sync:" + userID
	sub := s.rdb.Subscribe(ctx, channel)
	defer sub.Close()

	log.Printf("ws open  user=%s channel=%s", userID, channel)
	defer log.Printf("ws close user=%s", userID)

	// Discard inbound frames so the connection doesn't stall on write pressure.
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				cancel()
				return
			}
		}
	}()

	for {
		select {
		case msg, ok := <-sub.Channel():
			if !ok {
				return
			}
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteMessage(websocket.TextMessage, []byte(msg.Payload)); err != nil {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

// userIDFromToken validates the JWT and extracts the subject claim (user ID).
// The secret must match app.jwt.secret in file-storage/application.yml.
func (s *server) userIDFromToken(raw string) (string, error) {
	token, err := jwt.Parse(raw, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return s.jwtSecret, nil
	})
	if err != nil || !token.Valid {
		return "", jwt.ErrTokenSignatureInvalid
	}
	return token.Claims.GetSubject()
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
