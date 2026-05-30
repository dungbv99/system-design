package org.example.model;

import jakarta.persistence.*;
import lombok.*;

import java.util.UUID;

/**
 * Content-addressed storage unit. Blocks are identified by SHA-256 hash.
 * ref_count tracks how many FileVersions reference this block (for GC).
 */
@Entity
@Table(name = "blocks")
@Getter @Setter @NoArgsConstructor
public class Block {

    @Id
    private String id;

    @Column(nullable = false, unique = true, length = 64)
    private String hash;

    @Column(name = "size_bytes", nullable = false)
    private int sizeBytes;

    /** Path within the block storage root: "{hash[0:2]}/{hash}" */
    @Column(name = "storage_key", nullable = false, length = 500)
    private String storageKey;

    /** Reference count for GC: 0 = orphaned, safe to delete */
    @Column(name = "ref_count", nullable = false)
    private int refCount = 0;

    @PrePersist
    protected void prePersist() {
        if (id == null) id = UUID.randomUUID().toString();
    }
}
