package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// ── Service ───────────────────────────────────────────────────────────────

type authService struct {
	db           *gorm.DB
	jwtSecret    []byte
	expirationMs int64
}

type registerReq struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type authResp struct {
	Token   string `json:"token"`
	UserID  string `json:"userId"`
	Username string `json:"username"`
}

func (s *authService) register(req registerReq) (*authResp, error) {
	if req.Username == "" || req.Email == "" || req.Password == "" {
		return nil, fmt.Errorf("username, email and password are required")
	}

	var count int64
	s.db.Model(&User{}).Where("username = ?", req.Username).Count(&count)
	if count > 0 {
		return nil, fmt.Errorf("username already taken")
	}
	s.db.Model(&User{}).Where("email = ?", req.Email).Count(&count)
	if count > 0 {
		return nil, fmt.Errorf("email already registered")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	user := User{Username: req.Username, Email: req.Email, PasswordHash: string(hash)}
	if err := s.db.Create(&user).Error; err != nil {
		return nil, err
	}

	// One channel is created per user automatically on registration.
	channel := Channel{
		UserID:    user.ID,
		Name:      req.Username,
		StreamKey: generateStreamKey(),
		Title:     req.Username + "'s channel",
	}
	if err := s.db.Create(&channel).Error; err != nil {
		return nil, err
	}

	token, err := s.sign(user)
	if err != nil {
		return nil, err
	}
	return &authResp{Token: token, UserID: user.ID.String(), Username: user.Username}, nil
}

func (s *authService) login(req loginReq) (*authResp, error) {
	var user User
	if err := s.db.Where("username = ?", req.Username).First(&user).Error; err != nil {
		return nil, fmt.Errorf("invalid credentials")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return nil, fmt.Errorf("invalid credentials")
	}
	token, err := s.sign(user)
	if err != nil {
		return nil, err
	}
	return &authResp{Token: token, UserID: user.ID.String(), Username: user.Username}, nil
}

func (s *authService) sign(user User) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"sub":      user.ID.String(),
		"username": user.Username,
		"iat":      now.Unix(),
		"exp":      now.Add(time.Duration(s.expirationMs) * time.Millisecond).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.jwtSecret)
}

// ── Handler ───────────────────────────────────────────────────────────────

type authHandler struct{ svc *authService }

func (h *authHandler) register(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "invalid request body", http.StatusBadRequest)
		return
	}
	resp, err := h.svc.register(req)
	if err != nil {
		jsonErr(w, err.Error(), http.StatusBadRequest)
		return
	}
	jsonOK(w, resp, http.StatusCreated)
}

func (h *authHandler) login(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "invalid request body", http.StatusBadRequest)
		return
	}
	resp, err := h.svc.login(req)
	if err != nil {
		jsonErr(w, err.Error(), http.StatusUnauthorized)
		return
	}
	jsonOK(w, resp, http.StatusOK)
}
