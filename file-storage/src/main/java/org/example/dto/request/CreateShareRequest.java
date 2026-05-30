package org.example.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class CreateShareRequest {
    @NotBlank
    private String nodeId;

    /** user | link */
    @NotBlank
    private String shareType;

    /** Required for shareType=user */
    private String granteeEmail;

    /** read | edit | admin */
    private String permission = "read";

    /** ISO-8601 expiry, optional */
    private String expiresAt;
}
