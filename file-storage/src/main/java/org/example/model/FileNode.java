package org.example.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

/**
 * Represents a file or folder in the virtual namespace tree.
 * Named FileNode to avoid collision with java.io.File.
 */
@Entity
@Table(name = "nodes")
@Getter @Setter @NoArgsConstructor
public class FileNode {

    @Id
    private String id;

    @Column(name = "owner_id", nullable = false)
    private String ownerId;

    @Column(name = "parent_id")
    private String parentId;   // null = root

    @Column(nullable = false, length = 500)
    private String name;

    /** 'file' | 'folder' */
    @Column(name = "node_type", nullable = false, length = 10)
    private String nodeType;

    @Column(name = "is_deleted", nullable = false)
    private boolean deleted = false;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    protected void prePersist() {
        if (id == null) id = UUID.randomUUID().toString();
        createdAt = updatedAt = Instant.now();
    }

    @PreUpdate
    protected void preUpdate() {
        updatedAt = Instant.now();
    }
}
