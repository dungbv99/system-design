package main

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type User struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey"`
	Username     string    `gorm:"uniqueIndex;not null;size:50"`
	Email        string    `gorm:"uniqueIndex;not null"`
	PasswordHash string    `gorm:"column:password_hash;not null"`
	CreatedAt    time.Time
}

func (u *User) BeforeCreate(_ *gorm.DB) error {
	if u.ID == uuid.Nil {
		u.ID = uuid.New()
	}
	return nil
}

type Channel struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;column:user_id;index"`
	User      User      `gorm:"foreignKey:UserID"`
	Name      string    `gorm:"uniqueIndex;not null;size:100"`
	StreamKey string    `gorm:"column:stream_key;uniqueIndex;not null;size:100"`
	Title     string
	IsLive    bool      `gorm:"column:is_live;not null;default:false"`
	CreatedAt time.Time
}

func (c *Channel) BeforeCreate(_ *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return nil
}

type StreamSession struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey"`
	ChannelID   uuid.UUID  `gorm:"type:uuid;not null;column:channel_id;index"`
	Channel     Channel    `gorm:"foreignKey:ChannelID"`
	StartedAt   time.Time  `gorm:"not null"`
	EndedAt     *time.Time `gorm:"column:ended_at"`
	PeakViewers int        `gorm:"column:peak_viewers;not null;default:0"`
}

func (s *StreamSession) BeforeCreate(_ *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	if s.StartedAt.IsZero() {
		s.StartedAt = time.Now()
	}
	return nil
}
