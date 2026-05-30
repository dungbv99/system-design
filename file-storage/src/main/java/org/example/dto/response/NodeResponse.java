package org.example.dto.response;

import lombok.Builder;
import lombok.Data;

import java.time.Instant;

@Data @Builder
public class NodeResponse {
    private String id;
    private String parentId;
    private String name;
    private String nodeType;      // file | folder
    private long sizeBytes;       // 0 for folders
    private String contentHash;
    private int versionNumber;
    private Instant createdAt;
    private Instant updatedAt;
}
