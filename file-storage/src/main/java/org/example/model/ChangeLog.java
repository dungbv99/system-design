package org.example.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

/**
 * Global, monotonically-increasing event log per user.
 * Devices sync by polling events after their last-seen seq cursor.
 */
@Entity
@Table(name = "change_log")
@Getter @Setter @NoArgsConstructor
public class ChangeLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long seq;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "node_id", nullable = false)
    private String nodeId;

    @Column(name = "device_id")
    private String deviceId;

    /** create | update | delete | move */
    @Column(nullable = false, length = 20)
    private String op;

    @Column(name = "version_id")
    private String versionId;

    /** JSON payload with extra context (old_name, old_parent, etc.) */
    @Column(nullable = false, columnDefinition = "TEXT")
    private String payload = "{}";

    @Column(name = "occurred_at", nullable = false, updatable = false)
    private Instant occurredAt;

    @PrePersist
    protected void prePersist() {
        if (occurredAt == null) occurredAt = Instant.now();
    }
}
