package org.example.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.example.config.AppProperties;
import org.example.dto.request.UploadInitRequest;
import org.example.dto.response.UploadInitResponse;
import org.example.exception.AppException;
import org.example.model.*;
import org.example.repository.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Resumable multipart upload flow:
 *
 *  1. Client: POST /upload/init  → server returns upload_id + missing blocks (dedup!)
 *  2. Client: PUT /upload/{id}/block/{index} for each missing block (parallel OK)
 *  3. Client: POST /upload/{id}/commit → creates FileVersion + ChangeLog
 *
 * Block deduplication: the server checks which hashes it already has.
 * The client only uploads blocks not yet stored — potentially saving 100% of
 * bandwidth for unchanged files.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UploadService {

    private final UploadSessionRepository sessionRepo;
    private final BlockRepository blockRepo;
    private final FileVersionRepository versionRepo;
    private final FileNodeRepository nodeRepo;
    private final StorageService storage;
    private final ChunkerService chunker;
    private final NodeService nodeService;
    private final SyncService syncService;
    private final MergeService mergeService;
    private final AppProperties props;

    // ----------------------------------------------------------------
    //  Step 1 – Init
    // ----------------------------------------------------------------

    @Transactional
    public UploadInitResponse init(String userId, UploadInitRequest req) {
        // Resolve or create the file node
        FileNode node;
        if (req.getNodeId() != null) {
            node = nodeRepo.findByIdAndOwnerIdAndDeletedFalse(req.getNodeId(), userId)
                    .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Node not found"));
            if (!"file".equals(node.getNodeType())) {
                throw new AppException(HttpStatus.BAD_REQUEST, "Node is not a file");
            }
        } else {
            if (req.getFileName() == null || req.getFileName().isBlank()) {
                throw new AppException(HttpStatus.BAD_REQUEST, "fileName required when creating new file");
            }
            node = nodeService.createFileNode(userId, req.getParentId(), req.getFileName());
        }

        // Dedup check: which hashes are already stored?
        Set<String> declaredHashes = new LinkedHashSet<>(req.getBlockHashes());
        Set<String> existingHashes = blockRepo
                .findByHashIn(declaredHashes)
                .stream()
                .map(Block::getHash)
                .collect(Collectors.toSet());

        List<String> missing = req.getBlockHashes().stream()
                .filter(h -> !existingHashes.contains(h))
                .distinct()
                .toList();

        // Create upload session
        UploadSession session = new UploadSession();
        session.setNodeId(node.getId());
        session.setUserId(userId);
        session.setDeviceId(req.getDeviceId());
        session.setBlockHashes(new ArrayList<>(req.getBlockHashes()));
        session.setUploadedHashes(new ArrayList<>(existingHashes)); // pre-mark deduped blocks
        session.setExpiresAt(Instant.now().plusSeconds(props.getUpload().getSessionExpiryHours() * 3600L));
        session = sessionRepo.save(session);

        log.debug("Upload init: session={} node={} total={} missing={}",
                session.getId(), node.getId(), req.getBlockHashes().size(), missing.size());

        return UploadInitResponse.builder()
                .uploadId(session.getId())
                .nodeId(node.getId())
                .missingBlocks(missing)
                .totalBlocks(req.getBlockHashes().size())
                .dedupedBlocks(existingHashes.size())
                .build();
    }

    // ----------------------------------------------------------------
    //  Step 2 – Upload individual block
    // ----------------------------------------------------------------

    @Transactional
    public void uploadBlock(String userId, String uploadId, int index, byte[] data) {
        UploadSession session = requireSession(userId, uploadId);

        if (index < 0 || index >= session.getBlockHashes().size()) {
            throw new AppException(HttpStatus.BAD_REQUEST, "Block index out of range");
        }

        String declaredHash = session.getBlockHashes().get(index);
        String actualHash   = chunker.sha256(data);

        if (!declaredHash.equals(actualHash)) {
            throw new AppException(HttpStatus.BAD_REQUEST,
                    "Block hash mismatch at index " + index +
                    " (expected=" + declaredHash + ", got=" + actualHash + ")");
        }

        // Persist block (idempotent)
        if (!blockRepo.findByHash(actualHash).isPresent()) {
            Block block = new Block();
            block.setHash(actualHash);
            block.setSizeBytes(data.length);
            block.setStorageKey(actualHash.substring(0, 2) + "/" + actualHash);
            block.setRefCount(0);
            blockRepo.save(block);
            storage.store(actualHash, data);
            log.debug("Stored new block {} ({} bytes)", actualHash, data.length);
        }

        // Mark as uploaded in session
        List<String> uploaded = new ArrayList<>(session.getUploadedHashes());
        if (!uploaded.contains(actualHash)) {
            uploaded.add(actualHash);
            session.setUploadedHashes(uploaded);
            sessionRepo.save(session);
        }
    }

    // ----------------------------------------------------------------
    //  Step 3 – Commit
    // ----------------------------------------------------------------

    @Transactional
    public FileVersion commit(String userId, String uploadId) {
        UploadSession session = requireSession(userId, uploadId);

        // Verify all blocks received
        Set<String> uploaded = new HashSet<>(session.getUploadedHashes());
        List<String> missing = session.getBlockHashes().stream()
                .filter(h -> !uploaded.contains(h))
                .toList();

        if (!missing.isEmpty()) {
            throw new AppException(HttpStatus.CONFLICT,
                    "Upload incomplete. Missing blocks: " + missing.subList(0, Math.min(5, missing.size())));
        }

        FileNode node = nodeRepo.findById(session.getNodeId())
                .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Node not found"));

        // Calculate new version number
        int nextVersion = versionRepo.findMaxVersionNumber(node.getId())
                .map(v -> v + 1).orElse(1);

        // Compute file-level hash and size
        String contentHash = chunker.fileHash(session.getBlockHashes());
        long totalSize = session.getBlockHashes().stream()
                .mapToLong(h -> blockRepo.findByHash(h).map(b -> (long) b.getSizeBytes()).orElse(0L))
                .sum();

        // Create immutable version record
        FileVersion version = new FileVersion();
        version.setNodeId(node.getId());
        version.setVersionNumber(nextVersion);
        version.setSizeBytes(totalSize);
        version.setContentHash(contentHash);
        version.setBlockList(new ArrayList<>(session.getBlockHashes()));
        version.setCreatedBy(session.getDeviceId());
        version = versionRepo.save(version);

        // Increment ref counts for all blocks in this version
        for (String hash : session.getBlockHashes()) {
            blockRepo.adjustRefCount(hash, 1);
        }

        // Mark session done
        session.setStatus("complete");
        sessionRepo.save(session);

        // Append to change log → triggers WebSocket push to all devices
        syncService.appendLog(userId, node.getId(), session.getDeviceId(),
                nextVersion == 1 ? "create" : "update",
                version.getId(),
                String.format("{\"version\":%d,\"size\":%d,\"hash\":\"%s\"}",
                        nextVersion, totalSize, contentHash));

        // GC old versions if over limit
        gcOldVersions(node.getId(), nextVersion);

        log.info("Committed version {} for node {} (size={} bytes, blocks={})",
                nextVersion, node.getId(), totalSize, session.getBlockHashes().size());

        return version;
    }

    // ----------------------------------------------------------------
    //  GC: keep only the last N versions
    // ----------------------------------------------------------------

    private void gcOldVersions(String nodeId, int currentVersion) {
        int maxVersions = props.getUpload().getMaxVersionsPerFile();
        if (currentVersion <= maxVersions) return;

        int deleteBeforeVersion = currentVersion - maxVersions;
        List<FileVersion> old = versionRepo
                .findByNodeIdAndVersionNumberLessThan(nodeId, deleteBeforeVersion);

        for (FileVersion v : old) {
            for (String hash : v.getBlockList()) {
                blockRepo.adjustRefCount(hash, -1);
                blockRepo.findByHash(hash).ifPresent(block -> {
                    if (block.getRefCount() <= 0) {
                        storage.delete(hash);
                        blockRepo.delete(block);
                        log.debug("GC: deleted orphan block {}", hash);
                    }
                });
            }
            versionRepo.delete(v);
            log.debug("GC: deleted version {}.{}", nodeId, v.getVersionNumber());
        }
    }

    // ----------------------------------------------------------------

    private UploadSession requireSession(String userId, String uploadId) {
        UploadSession s = sessionRepo.findByIdAndUserId(uploadId, userId)
                .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Upload session not found"));
        if ("complete".equals(s.getStatus()) || "aborted".equals(s.getStatus())) {
            throw new AppException(HttpStatus.GONE, "Upload session already " + s.getStatus());
        }
        if (Instant.now().isAfter(s.getExpiresAt())) {
            throw new AppException(HttpStatus.GONE, "Upload session expired");
        }
        return s;
    }
}
