package org.example.dto.response;

import lombok.Builder;
import lombok.Data;

import java.time.Instant;
import java.util.List;

@Data @Builder
public class VersionResponse {
    private String id;
    private String nodeId;
    private int versionNumber;
    private long sizeBytes;
    private String contentHash;
    private List<String> blockList;
    private String createdBy;   // device id
    private Instant createdAt;
}
