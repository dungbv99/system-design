package org.example.dto.response;

import lombok.Builder;
import lombok.Data;

import java.time.Instant;

@Data @Builder
public class ShareResponse {
    private String id;
    private String nodeId;
    private String nodeName;
    private String shareType;
    private String granteeId;
    private String granteeEmail;
    private String permission;
    private String token;
    private String shareUrl;      // full link for link shares
    private Instant expiresAt;
    private Instant createdAt;
}
