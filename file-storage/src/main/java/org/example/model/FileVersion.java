package org.example.model;

import jakarta.persistence.*;
import lombok.*;
import org.example.converter.StringListConverter;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Immutable version snapshot of a file. Append-only — never mutated after creation.
 */
@Entity
@Table(name = "file_versions",
       uniqueConstraints = @UniqueConstraint(columnNames = {"node_id", "version_number"}))
@Getter @Setter @NoArgsConstructor
public class FileVersion {

    @Id
    private String id;

    @Column(name = "node_id", nullable = false)
    private String nodeId;

    @Column(name = "version_number", nullable = false)
    private int versionNumber;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes = 0;

    /** SHA-256 of the complete assembled file */
    @Column(name = "content_hash", length = 64)
    private String contentHash;

    /**
     * Ordered list of block hashes (SHA-256).
     * Stored as a JSON array in the DB.
     */
    @Column(name = "block_list", nullable = false, columnDefinition = "TEXT")
    @Convert(converter = StringListConverter.class)
    private List<String> blockList = new ArrayList<>();

    @Column(name = "created_by")
    private String createdBy;   // device id

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    protected void prePersist() {
        if (id == null) id = UUID.randomUUID().toString();
        if (createdAt == null) createdAt = Instant.now();
    }
}
