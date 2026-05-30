package org.example.controller;

import lombok.RequiredArgsConstructor;
import org.example.security.UserPrincipal;
import org.example.service.DownloadService;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Download flow:
 *
 *  GET /api/download/{versionId}/manifest  → ordered list of {index, hash, size}
 *  GET /api/download/block/{hash}          → raw block bytes (content-addressed, cacheable forever)
 *  GET /api/download/{versionId}/file      → assembled file (server-side concat)
 */
@RestController
@RequestMapping("/api/download")
@RequiredArgsConstructor
public class DownloadController {

    private final DownloadService downloadService;

    /** Returns the ordered block list for a version (client fetches blocks in parallel). */
    @GetMapping("/{versionId}/manifest")
    public List<DownloadService.BlockInfo> getManifest(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable String versionId) {
        return downloadService.getManifest(principal.getId(), versionId);
    }

    /**
     * Download a single block by hash.
     * Content-addressed → safe to cache indefinitely (immutable).
     */
    @GetMapping("/block/{hash}")
    public ResponseEntity<byte[]> getBlock(@PathVariable String hash) {
        byte[] data = downloadService.getBlock(hash);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CACHE_CONTROL, "public, max-age=31536000, immutable")
                .contentLength(data.length)
                .body(data);
    }

    /**
     * Download the complete file (server assembles all blocks then streams).
     * Good for small files and web UI downloads.
     */
    @GetMapping("/{versionId}/file")
    public ResponseEntity<byte[]> downloadFile(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable String versionId) {
        byte[] data = downloadService.assembleFile(principal.getId(), versionId);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment")
                .contentLength(data.length)
                .body(data);
    }
}
