package org.example.dto.response;

import lombok.Builder;
import lombok.Data;

import java.util.List;

@Data @Builder
public class UploadInitResponse {
    private String uploadId;
    private String nodeId;

    /**
     * Block hashes the server does NOT already have.
     * Client only needs to upload these; all other blocks are already deduplicated.
     */
    private List<String> missingBlocks;

    /** Total blocks declared */
    private int totalBlocks;

    /** Blocks server already has (deduped) */
    private int dedupedBlocks;
}
