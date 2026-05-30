package org.example.service;

import lombok.RequiredArgsConstructor;
import org.example.dto.response.SyncChangesResponse;
import org.example.model.ChangeLog;
import org.example.model.Device;
import org.example.repository.ChangeLogRepository;
import org.example.repository.DeviceRepository;
import org.example.websocket.ConnectionManager;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

/**
 * Change-log driven sync engine.
 *
 * Devices maintain a {@code syncCursor} — the highest seq they've seen.
 * Polling GET /sync/changes?since={cursor} returns all events after that cursor.
 * WebSocket push delivers events in real-time to connected clients.
 */
@Service
@RequiredArgsConstructor
public class SyncService {

    private static final int PAGE_SIZE = 500;

    private final ChangeLogRepository changeLogRepo;
    private final DeviceRepository deviceRepo;
    private final ConnectionManager connectionManager;

    // ----------------------------------------------------------------
    //  Poll-based sync
    // ----------------------------------------------------------------

    @Transactional(readOnly = true)
    public SyncChangesResponse getChanges(String userId, long sinceSeq) {
        List<ChangeLog> entries = changeLogRepo
                .findByUserIdAndSeqGreaterThanOrderBySeqAsc(
                        userId, sinceSeq, PageRequest.of(0, PAGE_SIZE));

        Long maxSeq = changeLogRepo.findMaxSeqForUser(userId);
        long latestSeq = maxSeq != null ? maxSeq : sinceSeq;

        List<SyncChangesResponse.ChangeEvent> events = entries.stream()
                .map(e -> SyncChangesResponse.ChangeEvent.builder()
                        .seq(e.getSeq())
                        .nodeId(e.getNodeId())
                        .deviceId(e.getDeviceId())
                        .op(e.getOp())
                        .versionId(e.getVersionId())
                        .payload(e.getPayload())
                        .occurredAt(e.getOccurredAt())
                        .build())
                .toList();

        return SyncChangesResponse.builder()
                .latestSeq(latestSeq)
                .events(events)
                .build();
    }

    // ----------------------------------------------------------------
    //  Write path (called by other services after mutations)
    // ----------------------------------------------------------------

    @Transactional
    public ChangeLog appendLog(String userId, String nodeId, String deviceId,
                               String op, String versionId, String payload) {
        ChangeLog entry = new ChangeLog();
        entry.setUserId(userId);
        entry.setNodeId(nodeId);
        entry.setDeviceId(deviceId);
        entry.setOp(op);
        entry.setVersionId(versionId);
        entry.setPayload(payload != null ? payload : "{}");
        entry = changeLogRepo.save(entry);

        // Push to all connected WebSocket clients for this user
        connectionManager.broadcastAsync(userId, buildPushPayload(entry));

        return entry;
    }

    // ----------------------------------------------------------------
    //  Device cursor management
    // ----------------------------------------------------------------

    @Transactional
    public void updateCursor(String deviceId, long cursor) {
        Device device = deviceRepo.findById(deviceId).orElse(null);
        if (device != null) {
            device.setSyncCursor(cursor);
            device.setLastSeen(Instant.now());
            deviceRepo.save(device);
        }
    }

    // ----------------------------------------------------------------

    private String buildPushPayload(ChangeLog e) {
        return String.format(
                "{\"seq\":%d,\"nodeId\":\"%s\",\"op\":\"%s\",\"versionId\":\"%s\",\"occurredAt\":\"%s\"}",
                e.getSeq(), e.getNodeId(), e.getOp(),
                e.getVersionId() != null ? e.getVersionId() : "",
                e.getOccurredAt().toString());
    }
}
