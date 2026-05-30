package main

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

// ── Service ───────────────────────────────────────────────────────────────

type channelService struct {
	db      *gorm.DB
	rdb     *redis.Client
	hlsBase string
}

type channelResp struct {
	ID          uuid.UUID `json:"id"`
	Username    string    `json:"username"`
	Title       string    `json:"title"`
	Live        bool      `json:"live"`
	ViewerCount int64     `json:"viewerCount"`
	HLSUrl      string    `json:"hlsUrl"`
}

func (s *channelService) toResp(ctx context.Context, ch Channel) channelResp {
	viewers, _ := s.rdb.Get(ctx, "viewers:"+ch.ID.String()).Int64()
	return channelResp{
		ID:          ch.ID,
		Username:    ch.Name,
		Title:       ch.Title,
		Live:        ch.IsLive,
		ViewerCount: viewers,
		HLSUrl:      s.hlsBase + "/live/" + ch.StreamKey + ".m3u8",
	}
}

func (s *channelService) listLive(ctx context.Context) ([]channelResp, error) {
	var channels []Channel
	if err := s.db.WithContext(ctx).Where("is_live = true").Find(&channels).Error; err != nil {
		return nil, err
	}
	out := make([]channelResp, len(channels))
	for i, ch := range channels {
		out[i] = s.toResp(ctx, ch)
	}
	return out, nil
}

func (s *channelService) getByID(ctx context.Context, id uuid.UUID) (*channelResp, error) {
	var ch Channel
	if err := s.db.WithContext(ctx).Where("id = ?", id).First(&ch).Error; err != nil {
		return nil, err
	}
	r := s.toResp(ctx, ch)
	return &r, nil
}

func (s *channelService) getMyChannel(ctx context.Context, userID uuid.UUID) (*channelResp, error) {
	var ch Channel
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).First(&ch).Error; err != nil {
		return nil, err
	}
	r := s.toResp(ctx, ch)
	return &r, nil
}

func (s *channelService) getStreamKey(ctx context.Context, userID uuid.UUID) (string, error) {
	var ch Channel
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).First(&ch).Error; err != nil {
		return "", err
	}
	return ch.StreamKey, nil
}

func (s *channelService) updateTitle(ctx context.Context, userID uuid.UUID, title string) (*channelResp, error) {
	var ch Channel
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).First(&ch).Error; err != nil {
		return nil, err
	}
	if err := s.db.WithContext(ctx).Model(&ch).Update("title", title).Error; err != nil {
		return nil, err
	}
	r := s.toResp(ctx, ch)
	return &r, nil
}

func (s *channelService) regenerateStreamKey(ctx context.Context, userID uuid.UUID) (string, error) {
	var ch Channel
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).First(&ch).Error; err != nil {
		return "", err
	}
	newKey := generateStreamKey()
	if err := s.db.WithContext(ctx).Model(&ch).Update("stream_key", newKey).Error; err != nil {
		return "", err
	}
	return newKey, nil
}

// ── Handler ───────────────────────────────────────────────────────────────

type channelHandler struct{ svc *channelService }

func (h *channelHandler) listLive(w http.ResponseWriter, r *http.Request) {
	channels, err := h.svc.listLive(r.Context())
	if err != nil {
		jsonErr(w, "internal error", http.StatusInternalServerError)
		return
	}
	jsonOK(w, channels, http.StatusOK)
}

func (h *channelHandler) getChannel(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		jsonErr(w, "invalid channel id", http.StatusBadRequest)
		return
	}
	ch, err := h.svc.getByID(r.Context(), id)
	if err != nil {
		jsonErr(w, "channel not found", http.StatusNotFound)
		return
	}
	jsonOK(w, ch, http.StatusOK)
}

func (h *channelHandler) getMyChannel(w http.ResponseWriter, r *http.Request) {
	ch, err := h.svc.getMyChannel(r.Context(), userIDFromCtx(r))
	if err != nil {
		jsonErr(w, "channel not found", http.StatusNotFound)
		return
	}
	jsonOK(w, ch, http.StatusOK)
}

func (h *channelHandler) getStreamKey(w http.ResponseWriter, r *http.Request) {
	key, err := h.svc.getStreamKey(r.Context(), userIDFromCtx(r))
	if err != nil {
		jsonErr(w, "channel not found", http.StatusNotFound)
		return
	}
	jsonOK(w, map[string]string{
		"streamKey": key,
		"rtmpUrl":   "rtmp://localhost:1935/live/" + key,
	}, http.StatusOK)
}

func (h *channelHandler) updateChannel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "invalid request body", http.StatusBadRequest)
		return
	}
	ch, err := h.svc.updateTitle(r.Context(), userIDFromCtx(r), req.Title)
	if err != nil {
		jsonErr(w, "channel not found", http.StatusNotFound)
		return
	}
	jsonOK(w, ch, http.StatusOK)
}

func (h *channelHandler) regenerateStreamKey(w http.ResponseWriter, r *http.Request) {
	key, err := h.svc.regenerateStreamKey(r.Context(), userIDFromCtx(r))
	if err != nil {
		jsonErr(w, "channel not found", http.StatusNotFound)
		return
	}
	jsonOK(w, map[string]string{
		"streamKey": key,
		"rtmpUrl":   "rtmp://localhost:1935/live/" + key,
	}, http.StatusOK)
}
