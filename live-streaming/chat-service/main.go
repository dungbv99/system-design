package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

const (
	maxMsgLen      = 500
	historyLen     = 50
	rateLimitDelay = 2 * time.Second
	writeTimeout   = 10 * time.Second
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type server struct {
	rdb       *redis.Client
	jwtSecret []byte
}

type chatMsg struct {
	Username  string `json:"username"`
	Content   string `json:"content"`
	Timestamp int64  `json:"timestamp"`
}

func main() {
	redisAddr := env("REDIS_ADDR", "localhost:6380")
	port := env("PORT", "8083")
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
	mux.HandleFunc("GET /health", s.health)
	// Connect: ws://host:8083/ws/{channelId}?token=<jwt>
	mux.HandleFunc("/ws/{channelId}", s.handleWS)

	log.Printf("chat-service listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok","service":"chat-service"}`))
}

func (s *server) handleWS(w http.ResponseWriter, r *http.Request) {
	channelID := r.PathValue("channelId")
	username, err := s.usernameFromToken(r.URL.Query().Get("token"))
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

	// Viewer count: increment on join, decrement on leave.
	viewerKey := fmt.Sprintf("viewers:%s", channelID)
	peakKey := fmt.Sprintf("peak_viewers:%s", channelID)
	count, _ := s.rdb.Incr(ctx, viewerKey).Result()
	// Atomic peak update via Lua script.
	s.rdb.Eval(ctx,
		`local p=tonumber(redis.call('GET',KEYS[1])) or 0
		 if tonumber(ARGV[1])>p then redis.call('SET',KEYS[1],ARGV[1]) end`,
		[]string{peakKey}, count,
	)
	defer s.rdb.Decr(context.Background(), viewerKey)

	log.Printf("ws open  user=%s channel=%s viewers=%d", username, channelID, count)
	defer log.Printf("ws close user=%s channel=%s", username, channelID)

	// Send last N messages as history on connect.
	histKey := fmt.Sprintf("chat:history:%s", channelID)
	history, _ := s.rdb.LRange(ctx, histKey, 0, int64(historyLen-1)).Result()
	for i := len(history) - 1; i >= 0; i-- {
		conn.SetWriteDeadline(time.Now().Add(writeTimeout))
		conn.WriteMessage(websocket.TextMessage, []byte(history[i]))
	}

	// Subscribe to channel for fanout from other connections.
	chatChannel := fmt.Sprintf("chat:%s", channelID)
	sub := s.rdb.Subscribe(ctx, chatChannel)
	defer sub.Close()

	// Redis → WebSocket pump.
	go func() {
		for {
			select {
			case msg, ok := <-sub.Channel():
				if !ok {
					return
				}
				conn.SetWriteDeadline(time.Now().Add(writeTimeout))
				if err := conn.WriteMessage(websocket.TextMessage, []byte(msg.Payload)); err != nil {
					cancel()
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	// WebSocket → Redis pump (with rate limiting per connection).
	var (
		lastMsg time.Time
		mu      sync.Mutex
	)
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}

		mu.Lock()
		throttled := time.Since(lastMsg) < rateLimitDelay
		if !throttled {
			lastMsg = time.Now()
		}
		mu.Unlock()
		if throttled {
			continue
		}

		content := strings.TrimSpace(string(raw))
		if len(content) == 0 || len(content) > maxMsgLen {
			continue
		}

		payload, _ := json.Marshal(chatMsg{
			Username:  username,
			Content:   content,
			Timestamp: time.Now().UnixMilli(),
		})

		s.rdb.Publish(ctx, chatChannel, payload)
		s.rdb.LPush(ctx, histKey, payload)
		s.rdb.LTrim(ctx, histKey, 0, int64(historyLen-1))
	}
}

// usernameFromToken validates the JWT and extracts the username claim.
// The secret must match JWT_SECRET in stream-api.
func (s *server) usernameFromToken(raw string) (string, error) {
	tok, err := jwt.Parse(raw, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return s.jwtSecret, nil
	})
	if err != nil || !tok.Valid {
		return "", jwt.ErrTokenSignatureInvalid
	}
	claims, ok := tok.Claims.(jwt.MapClaims)
	if !ok {
		return "", jwt.ErrTokenSignatureInvalid
	}
	username, _ := claims["username"].(string)
	if username == "" {
		return "", jwt.ErrTokenSignatureInvalid
	}
	return username, nil
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
