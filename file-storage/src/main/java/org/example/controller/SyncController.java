package org.example.controller;

import lombok.RequiredArgsConstructor;
import org.example.dto.response.SyncChangesResponse;
import org.example.security.UserPrincipal;
import org.example.service.SyncService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * REST sync API (polling fallback) + cursor management.
 *
 * Real-time sync uses WebSocket at /api/sync/ws?token={jwt}
 *
 * GET  /api/sync/changes?since={seq}       → events after cursor
 * PATCH /api/sync/device/{deviceId}/cursor → persist cursor update
 */
@RestController
@RequestMapping("/api/sync")
@RequiredArgsConstructor
public class SyncController {

    private final SyncService syncService;

    /**
     * Poll for changes since a given seq.
     * Returns up to 500 events in ascending seq order.
     * Client updates its local cursor to response.latestSeq after applying events.
     */
    @GetMapping("/changes")
    public SyncChangesResponse getChanges(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestParam(defaultValue = "0") long since) {
        return syncService.getChanges(principal.getId(), since);
    }

    /**
     * Persist a device's sync cursor after it has applied remote events.
     * Allows the server to track per-device sync state.
     */
    @PatchMapping("/device/{deviceId}/cursor")
    public ResponseEntity<Map<String, Object>> updateCursor(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable String deviceId,
            @RequestParam long cursor) {
        syncService.updateCursor(deviceId, cursor);
        return ResponseEntity.ok(Map.of("deviceId", deviceId, "cursor", cursor));
    }
}
