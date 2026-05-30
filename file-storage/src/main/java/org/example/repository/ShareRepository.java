package org.example.repository;

import org.example.model.Share;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ShareRepository extends JpaRepository<Share, String> {

    List<Share> findByOwnerId(String ownerId);

    List<Share> findByGranteeId(String granteeId);

    Optional<Share> findByToken(String token);

    Optional<Share> findByIdAndOwnerId(String id, String ownerId);
}
