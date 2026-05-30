package org.example.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import lombok.Data;

import java.util.List;

@Data
public class UploadInitRequest {

    /** Existing node id to create a new version on, OR null to create a new file */
    private String nodeId;

    /** Parent folder id (used only when nodeId is null to create a new file node) */
    private String parentId;

    /** File name (required when creating a new node) */
    private String fileName;

    /** Device initiating the upload */
    @NotBlank
    private String deviceId;

    /**
     * Ordered list of SHA-256 block hashes for the complete file.
     * Server compares against known blocks for deduplication.
     */
    @NotEmpty
    private List<String> blockHashes;

    /** Total assembled file size in bytes */
    private long totalSize;

    /**
     * The version this upload is based on (for conflict detection).
     * Null if creating a brand-new file.
     */
    private String baseVersionId;
}
