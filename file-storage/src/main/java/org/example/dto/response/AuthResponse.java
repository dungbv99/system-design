package org.example.dto.response;

import lombok.Builder;
import lombok.Data;

@Data @Builder
public class AuthResponse {
    private String token;
    private String userId;
    private String email;
    private String deviceId;
    private long quotaBytes;
    private long usedBytes;
}
