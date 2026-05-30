package org.example.repository;

import org.example.model.Block;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;
import java.util.Set;

public interface BlockRepository extends JpaRepository<Block, String> {

    Optional<Block> findByHash(String hash);

    List<Block> findByHashIn(Set<String> hashes);

    /** Orphaned blocks eligible for GC */
    List<Block> findByRefCountLessThanEqual(int refCount);

    @Modifying
    @Query("UPDATE Block b SET b.refCount = b.refCount + :delta WHERE b.hash = :hash")
    void adjustRefCount(String hash, int delta);
}
