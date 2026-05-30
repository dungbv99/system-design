package org.example.dto.response;

import lombok.Builder;
import lombok.Data;

import java.time.Instant;
import java.util.List;

@Data @Builder
public class SyncChangesResponse {
    private long latestSeq;
    private List<ChangeEvent> events;

    @Data @Builder
    public static class ChangeEvent {
        private long seq;
        private String nodeId;
        private String deviceId;
        private String op;          // create | update | delete | move
        private String versionId;
        private String payload;     // raw JSON
        private Instant occurredAt;
    }
}
