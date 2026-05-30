package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

// ── Service ───────────────────────────────────────────────────────────────

type streamEventService struct {
	db  *gorm.DB
	rdb *redis.Client
}

// srsHook is the payload SRS sends on on_publish / on_unpublish.
type srsHook struct {
	App    string `json:"app"`
	Stream string `json:"stream"` // this is the stream key
}

// onPublish is called by SRS when a publisher connects.
// Returns error → caller returns non-2xx → SRS rejects the stream (invalid key auth).
func (s *streamEventService) onPublish(ctx context.Context, streamKey string) error {
	var ch Channel
	if err := s.db.WithContext(ctx).Where("stream_key = ?", streamKey).First(&ch).Error; err != nil {
		return err // unknown stream key
	}

	s.db.WithContext(ctx).Model(&ch).Update("is_live", true)

	session := StreamSession{ChannelID: ch.ID, StartedAt: time.Now()}
	s.db.WithContext(ctx).Create(&session)

	s.rdb.Set(ctx, "viewers:"+ch.ID.String(), "0", 0)
	s.rdb.Set(ctx, "active_session:"+ch.ID.String(), session.ID.String(), 0)

	log.Printf("stream started: channel=%s key=%s", ch.ID, streamKey)
	return nil
}

// onUnpublish is called by SRS when the publisher disconnects.
func (s *streamEventService) onUnpublish(ctx context.Context, streamKey string) {
	var ch Channel
	if err := s.db.WithContext(ctx).Where("stream_key = ?", streamKey).First(&ch).Error; err != nil {
		return
	}

	s.db.WithContext(ctx).Model(&ch).Update("is_live", false)

	sessionIDStr, err := s.rdb.Get(ctx, "active_session:"+ch.ID.String()).Result()
	if err == nil {
		sessionID, _ := uuid.Parse(sessionIDStr)
		peak, _ := s.rdb.Get(ctx, "peak_viewers:"+ch.ID.String()).Int64()
		now := time.Now()
		s.db.WithContext(ctx).Model(&StreamSession{}).Where("id = ?", sessionID).Updates(map[string]any{
			"ended_at":     now,
			"peak_viewers": peak,
		})
	}

	s.rdb.Del(ctx,
		"viewers:"+ch.ID.String(),
		"peak_viewers:"+ch.ID.String(),
		"active_session:"+ch.ID.String(),
	)

	log.Printf("stream ended: channel=%s key=%s", ch.ID, streamKey)
}

// ── Handler ───────────────────────────────────────────────────────────────

type internalHandler struct{ svc *streamEventService }

func (h *internalHandler) onPublish(w http.ResponseWriter, r *http.Request) {
	var hook srsHook
	if err := json.NewDecoder(r.Body).Decode(&hook); err != nil {
		jsonErr(w, "bad request", http.StatusBadRequest)
		return
	}
	if err := h.svc.onPublish(r.Context(), hook.Stream); err != nil {
		// SRS reads the "code" field — non-zero rejects the publisher (invalid key auth).
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"code":1,"error":"unknown stream key"}`))
		return
	}
	// SRS requires {"code":0} in the response body — empty body is treated as an error.
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"code":0}`))
}

func (h *internalHandler) onUnpublish(w http.ResponseWriter, r *http.Request) {
	var hook srsHook
	json.NewDecoder(r.Body).Decode(&hook)
	h.svc.onUnpublish(r.Context(), hook.Stream)
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"code":0}`))
}
