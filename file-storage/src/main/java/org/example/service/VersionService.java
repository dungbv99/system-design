package org.example.service;

import lombok.RequiredArgsConstructor;
import org.example.dto.response.VersionResponse;
import org.example.exception.AppException;
import org.example.model.FileNode;
import org.example.model.FileVersion;
import org.example.repository.BlockRepository;
import org.example.repository.FileNodeRepository;
import org.example.repository.FileVersionRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

/**
 * Version history management.
 *
 * Versions are immutable and append-only.
 * Restoring a version creates a NEW version (v_n+1) with the same block list
 * as the target — it does not modify history.
 */
@Service
@RequiredArgsConstructor
public class VersionService {

    private final FileVersionRepository versionRepo;
    private final FileNodeRepository nodeRepo;
    private final BlockRepository blockRepo;
    private final StorageService storage;
    private final SyncService syncService;
    private final ChunkerService chunker;

    // ----------------------------------------------------------------
    //  List versions
    // ----------------------------------------------------------------

    public List<VersionResponse> listVersions(String userId, String nodeId) {
        requireFileNode(userId, nodeId);
        return versionRepo.findByNodeIdOrderByVersionNumberDesc(nodeId)
                .stream().map(this::toResponse).toList();
    }

    public VersionResponse getVersion(String userId, String nodeId, int versionNumber) {
        requireFileNode(userId, nodeId);
        return versionRepo.findByNodeIdAndVersionNumber(nodeId, versionNumber)
                .map(this::toResponse)
                .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Version not found"));
    }

    // ----------------------------------------------------------------
    //  Restore a version (creates new version with same block list)
    // ----------------------------------------------------------------

    @Transactional
    public VersionResponse restoreVersion(String userId, String nodeId,
                                          int versionNumber, String deviceId) {
        requireFileNode(userId, nodeId);
        FileVersion target = versionRepo.findByNodeIdAndVersionNumber(nodeId, versionNumber)
                .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Version not found"));

        int nextVersion = versionRepo.findMaxVersionNumber(nodeId)
                .map(v -> v + 1).orElse(1);

        FileVersion restored = new FileVersion();
        restored.setNodeId(nodeId);
        restored.setVersionNumber(nextVersion);
        restored.setSizeBytes(target.getSizeBytes());
        restored.setContentHash(target.getContentHash());
        restored.setBlockList(new ArrayList<>(target.getBlockList()));
        restored.setCreatedBy(deviceId);
        restored = versionRepo.save(restored);

        // Increment ref counts for restored blocks
        for (String hash : restored.getBlockList()) {
            blockRepo.adjustRefCount(hash, 1);
        }

        syncService.appendLog(userId, nodeId, deviceId, "update",
                restored.getId(),
                String.format("{\"restoredFrom\":%d,\"version\":%d}", versionNumber, nextVersion));

        return toResponse(restored);
    }

    // ----------------------------------------------------------------
    //  Manual deletion of a specific old version
    // ----------------------------------------------------------------

    @Transactional
    public void deleteVersion(String userId, String nodeId, int versionNumber) {
        requireFileNode(userId, nodeId);

        // Cannot delete the current (latest) version
        int maxVersion = versionRepo.findMaxVersionNumber(nodeId).orElse(0);
        if (versionNumber >= maxVersion) {
            throw new AppException(HttpStatus.BAD_REQUEST,
                    "Cannot delete the current version. Delete the file instead.");
        }

        FileVersion version = versionRepo.findByNodeIdAndVersionNumber(nodeId, versionNumber)
                .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Version not found"));

        for (String hash : version.getBlockList()) {
            blockRepo.adjustRefCount(hash, -1);
            blockRepo.findByHash(hash).ifPresent(block -> {
                if (block.getRefCount() <= 0) {
                    storage.delete(hash);
                    blockRepo.delete(block);
                }
            });
        }
        versionRepo.delete(version);
    }

    // ----------------------------------------------------------------

    private FileNode requireFileNode(String userId, String nodeId) {
        FileNode node = nodeRepo.findByIdAndOwnerIdAndDeletedFalse(nodeId, userId)
                .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "File not found"));
        if (!"file".equals(node.getNodeType())) {
            throw new AppException(HttpStatus.BAD_REQUEST, "Node is not a file");
        }
        return node;
    }

    private VersionResponse toResponse(FileVersion v) {
        return VersionResponse.builder()
                .id(v.getId())
                .nodeId(v.getNodeId())
                .versionNumber(v.getVersionNumber())
                .sizeBytes(v.getSizeBytes())
                .contentHash(v.getContentHash())
                .blockList(v.getBlockList())
                .createdBy(v.getCreatedBy())
                .createdAt(v.getCreatedAt())
                .build();
    }
}
