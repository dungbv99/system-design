package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type ctxKey string

const (
	ctxUserID   ctxKey = "userID"
	ctxUsername ctxKey = "username"
)

func jwtMiddleware(secret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			if !strings.HasPrefix(h, "Bearer ") {
				jsonErr(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			tok, err := jwt.Parse(strings.TrimPrefix(h, "Bearer "), func(t *jwt.Token) (interface{}, error) {
				if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, jwt.ErrSignatureInvalid
				}
				return secret, nil
			})
			if err != nil || !tok.Valid {
				jsonErr(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			claims := tok.Claims.(jwt.MapClaims)
			ctx := context.WithValue(r.Context(), ctxUserID, claims["sub"].(string))
			ctx = context.WithValue(ctx, ctxUsername, claims["username"].(string))
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func userIDFromCtx(r *http.Request) uuid.UUID {
	s, _ := r.Context().Value(ctxUserID).(string)
	id, _ := uuid.Parse(s)
	return id
}

func jsonErr(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func jsonOK(w http.ResponseWriter, v any, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
