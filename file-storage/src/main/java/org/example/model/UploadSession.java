package org.example.model;

import jakarta.persistence.*;
import lombok.*;
import org.example.converter.StringListConverter;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Tracks a resumable multipart upload.
 * Client declares all block hashes upfront; server tells which are missing.
 * Status: pending → complete | aborted
 */
@Entity
@Table(name = "upload_sessions")
@Getter @Setter @NoArgsConstructor
public class UploadSession {

    @Id
    private String id;

    @Column(name = "node_id", nullable = false)
    private String nodeId;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "device_id")
    private String deviceId;

    /** All block hashes in file order (declared at init time) */
    @Column(name = "block_hashes", nullable = false, columnDefinition = "TEXT")
    @Convert(converter = StringListConverter.class)
    private List<String> blockHashes = new ArrayList<>();

    /** Hashes that have been successfully received so far */
    @Column(name = "uploaded_hashes", nullable = false, columnDefinition = "TEXT")
    @Convert(converter = StringListConverter.class)
    private List<String> uploadedHashes = new ArrayList<>();

    /** pending | complete | aborted */
    @Column(nullable = false, length = 20)
    private String status = "pending";

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @PrePersist
    protected void prePersist() {
        if (id == null) id = UUID.randomUUID().toString();
        if (createdAt == null) createdAt = Instant.now();
    }
}
