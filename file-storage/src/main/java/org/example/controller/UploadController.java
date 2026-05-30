package org.example.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.example.dto.request.UploadInitRequest;
import org.example.dto.response.UploadInitResponse;
import org.example.dto.response.VersionResponse;
import org.example.model.FileVersion;
import org.example.security.UserPrincipal;
import org.example.service.UploadService;
import org.example.service.VersionService;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Resumable chunked upload flow:
 *
 *  POST /api/upload/init                           → get upload_id + missing blocks
 *  PUT  /api/upload/{uploadId}/block/{index}       → upload one block (raw bytes)
 *  GET  /api/upload/{uploadId}/status              → check progress
 *  POST /api/upload/{uploadId}/commit              → finalise → creates FileVersion
 */
@RestController
@RequestMapping("/api/upload")
@RequiredArgsConstructor
public class UploadController {

    private final UploadService uploadService;
    private final VersionService versionService;

    @PostMapping("/init")
    public ResponseEntity<UploadInitResponse> init(
            @AuthenticationPrincipal UserPrincipal principal,
            @Valid @RequestBody UploadInitRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(uploadService.init(principal.getId(), req));
    }

    /**
     * Upload a single block.
     * Body: raw bytes.  Header X-Block-Index must match the path {index}.
     */
    @PutMapping(value = "/{uploadId}/block/{index}",
                consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<Map<String, Object>> uploadBlock(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable String uploadId,
            @PathVariable int index,
            @RequestBody byte[] data) {
        uploadService.uploadBlock(principal.getId(), uploadId, index, data);
        return ResponseEntity.ok(Map.of("ok", true, "index", index, "size", data.length));
    }

    /** Commit the upload → creates an immutable FileVersion. */
    @PostMapping("/{uploadId}/commit")
    public ResponseEntity<VersionResponse> commit(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable String uploadId) {
        FileVersion version = uploadService.commit(principal.getId(), uploadId);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(VersionResponse.builder()
                        .id(version.getId())
                        .nodeId(version.getNodeId())
                        .versionNumber(version.getVersionNumber())
                        .sizeBytes(version.getSizeBytes())
                        .contentHash(version.getContentHash())
                        .blockList(version.getBlockList())
                        .createdBy(version.getCreatedBy())
                        .createdAt(version.getCreatedAt())
                        .build());
    }
}
