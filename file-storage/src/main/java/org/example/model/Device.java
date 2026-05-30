package org.example.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "devices")
@Getter @Setter @NoArgsConstructor
public class Device {

    @Id
    private String id;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(nullable = false, length = 255)
    private String name;

    @Column(length = 50)
    private String platform;

    @Column(name = "last_seen")
    private Instant lastSeen;

    @Column(name = "sync_cursor", nullable = false)
    private long syncCursor = 0;

    @PrePersist
    protected void prePersist() {
        if (id == null) id = UUID.randomUUID().toString();
        lastSeen = Instant.now();
    }
}
