package org.example.repository;

import org.example.model.FileVersion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface FileVersionRepository extends JpaRepository<FileVersion, String> {

    List<FileVersion> findByNodeIdOrderByVersionNumberDesc(String nodeId);

    Optional<FileVersion> findByNodeIdAndVersionNumber(String nodeId, int versionNumber);

    @Query("SELECT MAX(fv.versionNumber) FROM FileVersion fv WHERE fv.nodeId = :nodeId")
    Optional<Integer> findMaxVersionNumber(String nodeId);

    /** Versions older than keepAfterVersion (for GC) */
    List<FileVersion> findByNodeIdAndVersionNumberLessThan(String nodeId, int keepAfterVersion);
}
