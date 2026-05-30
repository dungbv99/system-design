package org.example.repository;

import org.example.model.ChangeLog;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface ChangeLogRepository extends JpaRepository<ChangeLog, Long> {

    /** Fetch events after a given seq for a user (cursor-based paging) */
    List<ChangeLog> findByUserIdAndSeqGreaterThanOrderBySeqAsc(
            String userId, long sinceSeq, Pageable pageable);

    @Query("SELECT MAX(cl.seq) FROM ChangeLog cl WHERE cl.userId = :userId")
    Long findMaxSeqForUser(String userId);
}
