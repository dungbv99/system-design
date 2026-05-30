package org.example.service;

import lombok.RequiredArgsConstructor;
import org.example.exception.AppException;
import org.example.model.Block;
import org.example.model.FileNode;
import org.example.model.FileVersion;
import org.example.repository.BlockRepository;
import org.example.repository.FileNodeRepository;
import org.example.repository.FileVersionRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Download flow:
 *
 *  Option A (manifest + per-block): client fetches manifest then downloads
 *  each block independently — supports parallel download and resume.
 *
 *  Option B (full file): server assembles and streams the complete file.
 *  Convenient for small files or web UI downloads.
 */
@Service
@RequiredArgsConstructor
public class DownloadService {

    private final FileVersionRepository versionRepo;
    private final FileNodeRepository nodeRepo;
    private final BlockRepository blockRepo;
    private final StorageService storage;

    public record BlockInfo(int index, String hash, int sizeBytes) {}

    // ----------------------------------------------------------------
    //  Manifest (block list) for a version
    // ----------------------------------------------------------------

    public List<BlockInfo> getManifest(String userId, String versionId) {
        FileVersion version = requireVersion(userId, versionId);
        List<String> hashes = version.getBlockList();

        return java.util.stream.IntStream.range(0, hashes.size())
                .mapToObj(i -> {
                    String hash = hashes.get(i);
                    int size = blockRepo.findByHash(hash)
                            .map(Block::getSizeBytes).orElse(0);
                    return new BlockInfo(i, hash, size);
                })
                .toList();
    }

    // ----------------------------------------------------------------
    //  Single block download
    // ----------------------------------------------------------------

    public byte[] getBlock(String hash) {
        blockRepo.findByHash(hash)
                .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Block not found: " + hash));
        return storage.load(hash);
    }

    // ----------------------------------------------------------------
    //  Full file download (assembled server-side)
    // ----------------------------------------------------------------

    public byte[] assembleFile(String userId, String versionId) {
        FileVersion version = requireVersion(userId, versionId);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (String hash : version.getBlockList()) {
            byte[] block = storage.load(hash);
            out.writeBytes(block);
        }
        return out.toByteArray();
    }

    // ----------------------------------------------------------------
    //  Latest version helper
    // ----------------------------------------------------------------

    public FileVersion getLatestVersion(String userId, String nodeId) {
        nodeRepo.findByIdAndOwnerIdAndDeletedFalse(nodeId, userId)
                .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Node not found"));
        return versionRepo.findByNodeIdOrderByVersionNumberDesc(nodeId)
                .stream().findFirst()
                .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "No versions found"));
    }

    // ----------------------------------------------------------------

    private FileVersion requireVersion(String userId, String versionId) {
        FileVersion version = versionRepo.findById(versionId)
                .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Version not found"));
        // Verify ownership
        nodeRepo.findByIdAndOwnerIdAndDeletedFalse(version.getNodeId(), userId)
                .orElseThrow(() -> new AppException(HttpStatus.FORBIDDEN, "Access denied"));
        return version;
    }
}
