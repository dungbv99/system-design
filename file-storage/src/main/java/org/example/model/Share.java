package org.example.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "shares")
@Getter @Setter @NoArgsConstructor
public class Share {

    @Id
    private String id;

    @Column(name = "node_id", nullable = false)
    private String nodeId;

    @Column(name = "owner_id", nullable = false)
    private String ownerId;

    /** user | link */
    @Column(name = "share_type", nullable = false, length = 10)
    private String shareType;

    /** null for link shares */
    @Column(name = "grantee_id")
    private String granteeId;

    /** read | edit | admin */
    @Column(nullable = false, length = 10)
    private String permission;

    /** non-null for link shares */
    @Column(unique = true, length = 64)
    private String token;

    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    protected void prePersist() {
        if (id == null) id = UUID.randomUUID().toString();
        if (createdAt == null) createdAt = Instant.now();
    }
}
