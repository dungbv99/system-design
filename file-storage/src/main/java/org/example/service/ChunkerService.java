package org.example.service;

import org.example.config.AppProperties;
import org.springframework.stereotype.Service;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;

/**
 * Content-Defined Chunking (CDC) service.
 *
 * Uses a rolling hash (Rabin-style fingerprint) to find chunk boundaries at
 * content-defined positions. This makes chunking diff-friendly: inserting bytes
 * near the start of a file only shifts boundaries in that region, leaving
 * downstream chunks unchanged → block-level deduplication survives edits.
 *
 * Chunk sizes: MIN_CHUNK ≤ target ≤ MAX_CHUNK (configurable in application.yml).
 */
@Service
public class ChunkerService {

    private final int minChunk;
    private final int maxChunk;

    /**
     * Mask selects boundary frequency.
     * MASK = (1 << 13) - 1 → ~8 KB average boundary spacing
     * giving ~4 MB average chunks when combined with MIN_CHUNK=512 KB.
     */
    private static final long BOUNDARY_MASK = (1L << 13) - 1;

    public ChunkerService(AppProperties props) {
        this.minChunk = props.getUpload().getMinBlockSize();
        this.maxChunk = props.getUpload().getMaxBlockSize();
    }

    /**
     * Split {@code data} into content-defined chunks.
     * Returns an ordered list of raw byte arrays.
     */
    public List<byte[]> chunk(byte[] data) {
        List<byte[]> chunks = new ArrayList<>();
        if (data == null || data.length == 0) return chunks;

        int start = 0;
        long fingerprint = 0;

        for (int i = 0; i < data.length; i++) {
            // Rolling hash: shift left, XOR in new byte
            fingerprint = ((fingerprint << 1) ^ (data[i] & 0xFFL)) & 0xFFFFFFFFL;
            int chunkLen = i - start + 1;

            boolean boundaryHit  = (chunkLen >= minChunk) && ((fingerprint & BOUNDARY_MASK) == 0);
            boolean maxExceeded  = chunkLen >= maxChunk;

            if (boundaryHit || maxExceeded) {
                chunks.add(Arrays.copyOfRange(data, start, i + 1));
                start = i + 1;
                fingerprint = 0;
            }
        }

        // Tail chunk (may be smaller than minChunk)
        if (start < data.length) {
            chunks.add(Arrays.copyOfRange(data, start, data.length));
        }

        return chunks;
    }

    /** Compute SHA-256 hex string of arbitrary bytes. */
    public String sha256(byte[] data) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(data));
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 unavailable", e);
        }
    }

    /** Compute SHA-256 over concatenated block hashes (file-level fingerprint). */
    public String fileHash(List<String> blockHashes) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            for (String h : blockHashes) md.update(h.getBytes());
            return HexFormat.of().formatHex(md.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 unavailable", e);
        }
    }
}
