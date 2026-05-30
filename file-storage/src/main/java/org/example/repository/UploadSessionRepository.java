package org.example.repository;

import org.example.model.UploadSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface UploadSessionRepository extends JpaRepository<UploadSession, String> {

    Optional<UploadSession> findByIdAndUserId(String id, String userId);

    /** Clean up expired sessions */
    List<UploadSession> findByStatusAndExpiresAtBefore(String status, Instant now);
}
