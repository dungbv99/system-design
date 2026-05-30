package org.example.repository;

import org.example.model.FileNode;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface FileNodeRepository extends JpaRepository<FileNode, String> {

    List<FileNode> findByOwnerIdAndParentIdIsNullAndDeletedFalse(String ownerId);

    List<FileNode> findByOwnerIdAndParentIdAndDeletedFalse(String ownerId, String parentId);

    Optional<FileNode> findByIdAndOwnerIdAndDeletedFalse(String id, String ownerId);

    /** Count total bytes used by a user (across all non-deleted file versions) */
    @Query("""
        SELECT COALESCE(SUM(fv.sizeBytes), 0)
        FROM FileVersion fv
        JOIN FileNode n ON fv.nodeId = n.id
        WHERE n.ownerId = :ownerId AND n.deleted = false
        """)
    long sumBytesUsedByUser(String ownerId);
}
